// #15 structurer-only — exercise MockStructurer against stub readers without
// going through the full ImportPipeline. Pins:
//
// - "Structurer-only test: with a stub CorpusReader + stub WikiReader + stub
//    WebSearch + a stub LLM client returning canned responses (no real API
//    call), the structurer's emitted drafts carry the expected origin
//    pointers for the fixture corpus."
// - "Structurer can issue web queries via the adapter at any extraction
//    step and consume results during extraction."
// - "Steering: same input + different target produces measurably different
//    draft prioritization on a fixture." (Mock-level: we expose the target's
//    role into the draft value so the test can pin observable difference.)
import { describe, expect, it } from "vitest";
import { MockStructurer } from "../../../src/adapters/structurer.js";
import { MockWebSearch } from "../../../src/adapters/web_search.js";
import { EmptyWikiReader } from "../../../src/wiki/reader.js";
import type { CorpusFile, CorpusListEntry, CorpusReader } from "../../../src/pipeline/types.js";

// Tiny synchronous stub matching the CorpusReader shape (read() is sync per
// the issue's interface sketch; the production FsCorpusReader is primed at
// pipeline entry to make this work).
class StubCorpusReader implements CorpusReader {
	private files = new Map<string, CorpusFile>();
	constructor(files: CorpusFile[]) {
		for (const f of files) this.files.set(`${f.path}::${f.version}`, f);
	}
	list(): CorpusListEntry[] {
		return Array.from(this.files.values()).map((f) => ({
			path: f.path,
			version: f.version,
			source_type: f.frontmatter.source_type,
		}));
	}
	read(path: string, version?: number): CorpusFile {
		// Find the (only) version of `path`, or the explicit version.
		for (const f of this.files.values()) {
			if (f.path === path && (version === undefined || f.version === version)) return f;
		}
		throw new Error(`stub corpus: ${path} not found`);
	}
}

function mkFile(path: string, source_type: string, body: string, version = 1): CorpusFile {
	return {
		path,
		version,
		frontmatter: {
			source_type,
			source_url: null,
			fetched_at: new Date(Date.UTC(2026, 4, 1)).toISOString(),
			content_hash: `sha256:stub-${path}-v${version}`,
		},
		body,
	};
}

describe("MockStructurer — origin pinning", () => {
	// WHY: load-bearing. Drafts must carry a corpus-origin pointer pinned to
	// the version they were extracted from; without it the publish-time
	// Verifier has nothing to ground against and the rest of #15's privacy
	// model falls apart.
	it("attaches origin pointers from the corpus entries it processed", async () => {
		const s = new MockStructurer();
		s.register("paste", [{ type: "skill", value: { name: "TypeScript" } }]);
		const corpus = new StubCorpusReader([mkFile("paste.md", "paste", "I know TypeScript", 3)]);
		const result = await s.structure({
			corpus,
			wiki: new EmptyWikiReader(),
			web: new MockWebSearch(),
		});
		expect(result.drafts).toHaveLength(1);
		expect(result.drafts[0]!.origin).toEqual([{ path: "paste.md", version: 3 }]);
	});

	// WHY: with no registered fixture, the structurer's default behavior is
	// to wrap the corpus body in a `narrative` claim. This is the "we read
	// it but had nothing structured to say" fallback — matches #7's old
	// MockStructurer for back-compat.
	it("falls back to a narrative wrapper when no fixture is registered", async () => {
		const s = new MockStructurer();
		const corpus = new StubCorpusReader([mkFile("paste.md", "paste", "free-form text", 1)]);
		const result = await s.structure({ corpus, wiki: new EmptyWikiReader(), web: new MockWebSearch() });
		expect(result.drafts).toHaveLength(1);
		expect(result.drafts[0]!.type).toBe("narrative");
		expect(result.drafts[0]!.value.text).toBe("free-form text");
		expect(result.drafts[0]!.origin).toEqual([{ path: "paste.md", version: 1 }]);
	});
});

describe("MockStructurer — web search hook", () => {
	// WHY: #17 acceptance — "Structurer can issue web queries via the
	// adapter at any extraction step and consume results during
	// extraction." Without this hook, MockStructurer never touches the web
	// adapter and the integration is unprovable.
	it("calls web.search when a query is registered and surfaces results to drafts", async () => {
		const s = new MockStructurer();
		s.register("paste", [{ type: "skill", value: { name: "Rust" } }]);
		s.useWebQuery("paste", "rust language popularity 2026");

		const web = new MockWebSearch();
		web.register("rust language popularity", [
			{ url: "https://example.com/rust-survey", title: "Rust survey 2026", snippet: "...", fetched_at: "2026-05-01" },
		]);

		const corpus = new StubCorpusReader([mkFile("paste.md", "paste", "I use Rust daily", 1)]);
		const result = await s.structure({ corpus, wiki: new EmptyWikiReader(), web });

		const corroboration = result.drafts[0]!.value._web_corroboration as { url: string }[];
		expect(corroboration).toBeDefined();
		expect(corroboration[0]!.url).toBe("https://example.com/rust-survey");
	});

	// WHY: a registered query that returns no results must not break the
	// run — the structurer proceeds without corroboration. Pin so a future
	// regression doesn't silently swallow a meaningful failure.
	it("returns drafts even when web.search has no fixture for the query", async () => {
		const s = new MockStructurer();
		s.register("paste", [{ type: "skill", value: { name: "Go" } }]);
		s.useWebQuery("paste", "anything-unregistered");

		const corpus = new StubCorpusReader([mkFile("paste.md", "paste", "Go is fine", 1)]);
		const result = await s.structure({ corpus, wiki: new EmptyWikiReader(), web: new MockWebSearch() });
		expect(result.drafts).toHaveLength(1);
		expect(result.drafts[0]!.value._web_corroboration).toEqual([]);
	});
});

describe("MockStructurer — target-based steering", () => {
	// WHY: pins the #15 acceptance "same input + different target produces
	// measurably different draft prioritization". MockStructurer's
	// Mock-level realization is to expose the target's role into the draft
	// value; a real LlmStructurer would do something semantically richer.
	// The TEST shape pins that DIFFERENT targets → DIFFERENT drafts, not
	// that the mechanism is sophisticated.
	it("same fixture + different target.role produces measurably different drafts", async () => {
		const s = new MockStructurer();
		s.enableTargetExposure();
		s.register("paste", [{ type: "skill", value: { name: "TypeScript" } }]);

		const corpus = new StubCorpusReader([mkFile("paste.md", "paste", "I know TypeScript", 1)]);
		const a = await s.structure({
			corpus,
			wiki: new EmptyWikiReader(),
			web: new MockWebSearch(),
			target: { role: "staff-platform-engineer" },
		});
		const b = await s.structure({
			corpus,
			wiki: new EmptyWikiReader(),
			web: new MockWebSearch(),
			target: { role: "frontend-engineer" },
		});
		expect(a.drafts[0]!.value._target_role).toBe("staff-platform-engineer");
		expect(b.drafts[0]!.value._target_role).toBe("frontend-engineer");
		expect(a.drafts[0]!.value).not.toEqual(b.drafts[0]!.value);
	});
});

describe("MockStructurer — wiki proposal + consumed-wiki hooks", () => {
	// WHY: pins #17 acceptance "Wiki gap-filling produces a Promote-ready
	// draft". The pipeline integration is tested separately end-to-end;
	// here we pin that the Mock surfaces a proposal for a registered
	// source_type.
	it("emits registered wiki proposals alongside drafts", async () => {
		const s = new MockStructurer();
		s.registerWikiProposal("paste", [
			{
				kind: "skill",
				slug: "embedded-rust",
				markdown: "---\nkind: skill\nslug: embedded-rust\n---\n## Signal\n\n> sources: 1\n",
			},
		]);

		const corpus = new StubCorpusReader([mkFile("paste.md", "paste", "I write firmware in Rust", 1)]);
		const result = await s.structure({ corpus, wiki: new EmptyWikiReader(), web: new MockWebSearch() });
		expect(result.wiki_proposals).toHaveLength(1);
		expect(result.wiki_proposals![0]!.slug).toBe("embedded-rust");
	});

	// WHY: pins the #16 usage-tracking hook data shape. The pipeline
	// records (slug, claim_id, used_at) at publish; the structurer is the
	// origin of `slug`. Pin the structurer reports it.
	it("reports consumed wiki slugs in result.wiki_slugs_used", async () => {
		const s = new MockStructurer();
		s.register("paste", [{ type: "skill", value: { name: "TypeScript" } }]);
		s.registerConsumedWiki("paste", ["distributed-systems", "code-review"]);

		const corpus = new StubCorpusReader([mkFile("paste.md", "paste", "TypeScript code", 1)]);
		const result = await s.structure({ corpus, wiki: new EmptyWikiReader(), web: new MockWebSearch() });
		expect(result.wiki_slugs_used).toEqual(["distributed-systems", "code-review"]);
	});
});
