// #15 structurer adapter. The interface here is the pluggability point a
// concrete LLM-backed structurer plugs into; the rest of the pipeline is
// LLM-free. Per #15's BYO model, no concrete LLM impl ships in this PR — the
// `MockStructurer` is the only impl, fixture-driven for tests, and the
// pipeline always has *some* structurer.
//
// Signature breaking change from #7's Phase 9 (`structure({raw, source})`):
// the structurer now reads from the corpus + wiki + web adapters and emits
// drafts pinned to corpus versions, plus optional conflict records and
// pending wiki proposals. Call sites in admin/imports.ts now go through
// ImportPipeline.ingest(); they no longer call the structurer directly.
import type { WikiReader } from "../wiki/reader.js";
import type { WebSearch } from "./web_search.js";
import type {
	CorpusListEntry,
	CorpusOrigin,
	CorpusReader,
	DraftInput,
	StructureResult,
	Target,
	WikiProposalDraft,
} from "../pipeline/types.js";
import type { Visibility } from "../domain/types.js";

export interface Structurer {
	structure(input: {
		corpus: CorpusReader;
		wiki: WikiReader;
		web: WebSearch;
		target?: Target;
		// The corpus files this ingest call just wrote. A real LLM-backed
		// structurer might use this to prioritize the fresh content while
		// still allowing cross-referencing with the rest of the corpus the
		// reader exposes. Empty when called from a path that doesn't have a
		// "new this run" notion (e.g. a hypothetical re-run).
		new_origins?: CorpusOrigin[];
	}): Promise<StructureResult>;
}

// Fixture entry registered against a corpus source_type. The drafts here lack
// origin pointers; MockStructurer attaches them automatically based on the
// corpus files it observes, so tests don't have to know the corpus paths.
export interface MockDraftFixture {
	type: string;
	value: Record<string, unknown>;
	visibility?: Visibility;
}

export class MockStructurer implements Structurer {
	private fixtures = new Map<string, MockDraftFixture[]>();
	private wikiProposals = new Map<string, WikiProposalDraft[]>();

	// Backwards-compatible registration that #7 tests use. The string key is the
	// `source_type` (also the `source` field on the resulting drafts — matches
	// what existing imports.test.ts asserts on).
	register(source_type: string, drafts: MockDraftFixture[]): void {
		this.fixtures.set(source_type, drafts);
	}

	// Register a wiki gap-filling proposal the structurer surfaces alongside its
	// drafts when it sees a given source_type. Test-only.
	registerWikiProposal(source_type: string, proposals: WikiProposalDraft[]): void {
		this.wikiProposals.set(source_type, proposals);
	}

	async structure(input: {
		corpus: CorpusReader;
		wiki: WikiReader;
		web: WebSearch;
		target?: Target;
		new_origins?: CorpusOrigin[];
	}): Promise<StructureResult> {
		const entries: CorpusListEntry[] = input.corpus.list();
		const drafts: DraftInput[] = [];
		const wiki_proposals: WikiProposalDraft[] = [];

		// Restrict the run to the corpus files this ingest just wrote. The
		// pipeline always passes new_origins; tests that call structurer
		// directly without going through the pipeline supply their own
		// fixtures and can omit it (in which case the structurer runs against
		// every file in the corpus — handy for cross-source structurer-only
		// unit tests).
		const newSet = new Set(
			(input.new_origins ?? entries.map((e) => ({ path: e.path, version: e.version })))
				.map((o) => `${o.path}::${o.version}`),
		);

		const seenSourceTypes = new Set<string>();
		for (const entry of entries) {
			if (!newSet.has(`${entry.path}::${entry.version}`)) continue;
			seenSourceTypes.add(entry.source_type);
		}

		// Pick one corpus file per source_type for fixture-pinning. If multiple
		// files of the same source_type are new this run (e.g. LinkedIn primary
		// + per-article files), the primary one — identified by being a
		// top-level `.md` rather than nested — is picked. This is a Mock-level
		// heuristic and doesn't constrain real implementations.
		const pinByType = new Map<string, { path: string; version: number }>();
		for (const entry of entries) {
			if (!newSet.has(`${entry.path}::${entry.version}`)) continue;
			const existing = pinByType.get(entry.source_type);
			const isTopLevel = !entry.path.includes("/");
			if (!existing || (isTopLevel && existing.path.includes("/"))) {
				pinByType.set(entry.source_type, { path: entry.path, version: entry.version });
			}
		}

		for (const source_type of seenSourceTypes) {
			const pin = pinByType.get(source_type)!;
			const fixture = this.fixtures.get(source_type);
			if (fixture && fixture.length > 0) {
				for (const f of fixture) {
					drafts.push({
						type: f.type,
						value: f.value,
						visibility: f.visibility,
						origin: [{ path: pin.path, version: pin.version }],
					});
				}
			} else {
				const file = input.corpus.read(pin.path, pin.version);
				drafts.push({
					type: "narrative",
					value: { text: file.body, scope: source_type },
					origin: [{ path: pin.path, version: pin.version }],
				});
			}
			const proposals = this.wikiProposals.get(source_type);
			if (proposals) wiki_proposals.push(...proposals);
		}
		return { drafts, conflicts: [], wiki_proposals };
	}
}
