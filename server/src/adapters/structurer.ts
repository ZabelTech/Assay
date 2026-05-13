import type { Visibility } from "../domain/types.js";
import type {
	CorpusListEntry,
	CorpusOrigin,
	CorpusReader,
	DraftInput,
	StructureResult,
	Target,
	WikiProposalDraft,
} from "../pipeline/types.js";
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
import { CodexCliStructurer } from "./codex_cli_structurer.js";
import type { WebSearch } from "./web_search.js";

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
	private webQueries = new Map<string, string>();
	private consumedWiki = new Map<string, string[]>();
	// When set, MockStructurer appends `_target_role: target.role` to every
	// draft's value so target-based steering is observable in tests. Real
	// LlmStructurers wouldn't need this — they'd use the target to prioritize.
	private exposeTarget = false;

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

	// Register a query the Mock should hit via the WebSearch adapter when it
	// processes a given source_type. The results are appended to each draft's
	// value as `_web_corroboration` so tests can assert (a) web.search was
	// invoked, (b) results landed where the structurer would consume them.
	useWebQuery(source_type: string, query: string): void {
		this.webQueries.set(source_type, query);
	}

	// Register the wiki slugs the Mock should report as "consumed" when it
	// processes a given source_type. The pipeline records wiki_page_uses
	// rows for these at publish time.
	registerConsumedWiki(source_type: string, slugs: string[]): void {
		this.consumedWiki.set(source_type, slugs);
	}

	// Switch on the steering hook: drafts get `_target_role` set to
	// `target.role`. Tests assert two runs with different targets produce
	// measurably different drafts.
	enableTargetExposure(): void {
		this.exposeTarget = true;
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
			(input.new_origins ?? entries.map((e) => ({ path: e.path, version: e.version }))).map(
				(o) => `${o.path}::${o.version}`,
			),
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

		const wiki_slugs_used: string[] = [];
		for (const source_type of seenSourceTypes) {
			const pin = pinByType.get(source_type)!;
			const fixture = this.fixtures.get(source_type);
			// Web-search hook: when a query is registered, hit the adapter and
			// hand the structurer's result-shape back to tests via the draft's
			// value. A real LLM would feed these into its context window.
			let webCorroboration: { url: string; title: string }[] | undefined;
			const query = this.webQueries.get(source_type);
			if (query) {
				const results = await input.web.search(query);
				webCorroboration = results.map((r) => ({ url: r.url, title: r.title }));
			}
			// Steering exposure: surface target.role into the draft value so
			// tests can assert different targets produce different output.
			const targetTag =
				this.exposeTarget && input.target?.role ? { _target_role: input.target.role } : {};
			const webTag = webCorroboration ? { _web_corroboration: webCorroboration } : {};
			if (fixture && fixture.length > 0) {
				for (const f of fixture) {
					drafts.push({
						type: f.type,
						value: { ...f.value, ...webTag, ...targetTag },
						visibility: f.visibility,
						origin: [{ path: pin.path, version: pin.version }],
					});
				}
			} else {
				const file = input.corpus.read(pin.path, pin.version);
				drafts.push({
					type: "narrative",
					value: { text: file.body, scope: source_type, ...webTag, ...targetTag },
					origin: [{ path: pin.path, version: pin.version }],
				});
			}
			const proposals = this.wikiProposals.get(source_type);
			if (proposals) wiki_proposals.push(...proposals);
			const consumed = this.consumedWiki.get(source_type);
			if (consumed) wiki_slugs_used.push(...consumed);
		}
		return { drafts, conflicts: [], wiki_proposals, wiki_slugs_used };
	}
}

// Selection helper used by index.ts. Mirrors selectVerifier in
// adapters/verifier.ts. CODEX_CLI=1 opts into the Codex CLI engine (#18) so
// imports bill against a ChatGPT subscription quota instead of an OpenAI API
// key. With no opt-in, the MockStructurer is used — production with real LLM
// is still a #15 follow-up beyond this engine.
export function selectStructurer(env: NodeJS.ProcessEnv = process.env): Structurer {
	if (env.CODEX_CLI === "1") {
		return new CodexCliStructurer({ model: env.CODEX_MODEL });
	}
	return new MockStructurer();
}
