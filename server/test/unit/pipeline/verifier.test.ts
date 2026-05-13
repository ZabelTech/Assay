// #15 Verifier. Two concrete impls ship in this PR — SubstringVerifier
// (deterministic; the default in production) and PassThroughVerifier (for
// tests that don't exercise verification semantics). The acceptance bullets
// pinned here:
//
// - "Verifier rejection path: a stub Verifier returning {ok: false, reason: ...}
//    causes the pipeline to reject the publish and surface reason via the
//    admin API." (the pipeline integration is pinned by import-pipeline.test;
//    this file pins SubstringVerifier's semantics.)
// - "Provenance check: a synthetic draft injected directly into the publish
//    path (bypassing the structurer) with no corpus grounding is rejected
//    by the Verifier; the candidate sees the unsupported text surfaced."
import { describe, expect, it } from "vitest";
import { PassThroughVerifier, SubstringVerifier } from "../../../src/adapters/verifier.js";
import type { CorpusFile, DraftInput } from "../../../src/pipeline/types.js";

const mkCorpus = (body: string): CorpusFile => ({
	path: "paste.md",
	version: 1,
	frontmatter: { source_type: "paste", source_url: null, fetched_at: "2026-05-01T00:00:00Z", content_hash: "sha256:abc" },
	body,
});

const mkDraft = (value: Record<string, unknown>): DraftInput => ({
	type: "skill",
	value,
	origin: [{ path: "paste.md", version: 1 }],
});

describe("SubstringVerifier", () => {
	// WHY: the happy path — a draft value whose strings all appear in the
	// cited corpus passes. This is the contract the structurer's system
	// prompt is supposed to honor.
	it("returns ok=true when every value string is present in the corpus", async () => {
		const v = new SubstringVerifier();
		const res = await v.verify({
			draft: mkDraft({ name: "TypeScript", years: 8 }),
			cited_corpus: [mkCorpus("I have 8 years with TypeScript and Rust.")],
		});
		expect(res.ok).toBe(true);
	});

	// WHY: case-insensitive matching is essential — the corpus might say
	// "TypeScript" and the extracted draft might say "typescript"; the LLM
	// would normalize. Pin that the verifier accepts that normalization.
	it("is case-insensitive", async () => {
		const v = new SubstringVerifier();
		const res = await v.verify({
			draft: mkDraft({ name: "typescript" }),
			cited_corpus: [mkCorpus("TYPESCRIPT is my main language")],
		});
		expect(res.ok).toBe(true);
	});

	// WHY: the load-bearing rejection — a draft string that isn't in any
	// cited corpus file is the hallucination signature. The verifier must
	// surface which specific string failed so the candidate sees what's
	// unsupported in the review surface.
	it("returns ok=false with the unsupported string in the reason", async () => {
		const v = new SubstringVerifier();
		const res = await v.verify({
			draft: mkDraft({ name: "Rust", title: "Galactic Emperor of Concurrency" }),
			cited_corpus: [mkCorpus("I am a Rust developer.")],
		});
		expect(res.ok).toBe(false);
		expect(res.reason).toMatch(/Galactic Emperor/i);
	});

	// WHY: nested values (objects, arrays) are common in claim shapes;
	// pin that the recursion picks up nested strings too. A loophole here
	// would let hallucinations smuggle into arrays.
	it("checks strings nested in arrays and sub-objects", async () => {
		const v = new SubstringVerifier();
		const ok = await v.verify({
			draft: mkDraft({ name: "TypeScript", details: { since: "2018", tags: ["frontend", "backend"] } }),
			cited_corpus: [mkCorpus("TypeScript since 2018 across frontend and backend")],
		});
		expect(ok.ok).toBe(true);

		const fail = await v.verify({
			draft: mkDraft({ details: { tags: ["frontend", "mainframes"] } }),
			cited_corpus: [mkCorpus("TypeScript across frontend only")],
		});
		expect(fail.ok).toBe(false);
		expect(fail.reason).toMatch(/mainframes/i);
	});

	// WHY: empty strings shouldn't fail verification — they have no claim
	// content to verify. Skipping them avoids spurious rejections on
	// optional fields that the structurer left empty.
	it("skips empty strings without failing verification", async () => {
		const v = new SubstringVerifier();
		const res = await v.verify({
			draft: mkDraft({ name: "TypeScript", summary: "" }),
			cited_corpus: [mkCorpus("TypeScript developer")],
		});
		expect(res.ok).toBe(true);
	});
});

describe("PassThroughVerifier", () => {
	// WHY: the default for tests that don't care about verification — used
	// by the buildTestServer helper so existing #7 fixture tests don't trip
	// on values that aren't substrings of the synthetic raw input. Pin
	// that it always returns ok=true; tests rely on this.
	it("always returns ok=true", async () => {
		const v = new PassThroughVerifier();
		const res = await v.verify({
			draft: mkDraft({ totally_unsupported: "field" }),
			cited_corpus: [mkCorpus("entirely unrelated content")],
		});
		expect(res.ok).toBe(true);
	});
});
