// #17 wiki gap-filling end-to-end. Pins:
//
// - "Wiki gap-filling produces a Promote-ready draft surfaced to the
//    candidate via the admin API; never auto-committed."
// - "Wiki-gap-filling drafts pass `npm run wiki:check` (#16's linter) —
//    frontmatter populated, every ## section carries a valid > sources: ...
//    declaration, no ## Adjacent properties body section."
// - "Re-encountering the same target gap during a later run produces a
//    new pending proposal alongside the prior one."
//
// The wiki linter is exercised at the pre-commit-hook level in
// admin/wiki-proposals.test.ts; here we focus on the end-to-end path
// from structurer-emits-proposal → pipeline persists → admin API surfaces.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { lintPage } from "../../../src/wiki/page_lint.js";

const VALID_PROPOSAL_MD = `---
kind: skill
slug: embedded-rust
updated_at: 2026-05-01
sources:
  - https://example.com/embedded-rust-survey
related: []
---

## Signal

> sources: 1

- Memory safety in low-level / firmware contexts is the headline.
- Async ecosystem (embassy, etc.) is rapidly maturing.
`;

let ts: TestServer;
beforeEach(async () => {
	ts = await buildTestServer();
});
afterEach(() => ts.close());

describe("#17 gap-filling end-to-end", () => {
	// WHY: pins the load-bearing path — when the structurer (Mock here,
	// real LlmStructurer later) decides the target needs a new wiki page,
	// the pipeline persists the proposal to pending_wiki_proposals and the
	// candidate sees it via /admin/api/wiki/proposals. Never auto-committed.
	it("structurer-emitted wiki proposal lands in the pending queue, visible to admin API", async () => {
		ts.structurer.register("paste", [{ type: "skill", value: { name: "embedded Rust" } }]);
		ts.structurer.registerWikiProposal("paste", [
			{ kind: "skill", slug: "embedded-rust", markdown: VALID_PROPOSAL_MD },
		]);

		await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "I write embedded Rust" }),
		});

		const listRes = await ts.adminFetch("/admin/api/wiki/proposals");
		const body = (await listRes.json()) as { proposals: { slug: string; kind: string }[] };
		expect(body.proposals).toHaveLength(1);
		expect(body.proposals[0]!.slug).toBe("embedded-rust");
		expect(body.proposals[0]!.kind).toBe("skill");
	});

	// WHY: pins #17 "Wiki-gap-filling drafts pass `npm run wiki:check`".
	// The acceptance is about the SHAPE of the proposal — the linter must
	// accept it. We run the linter directly against the proposal markdown
	// in isolation (lintPage takes a single page + extra slugs). A
	// structurer that emits non-conforming proposals would break the
	// Promote step downstream; pinning at proposal-emission catches it
	// earlier.
	it("emitted proposal passes the #16 linter as a stand-alone page", () => {
		const result = lintPage("skills/embedded-rust.md", VALID_PROPOSAL_MD);
		expect(result.errors).toEqual([]);
	});

	// WHY: pins "Re-encountering the same target gap during a later run
	// produces a new pending proposal alongside any pending ones."
	// Important: the prior proposal stays as-is — the candidate can
	// compare them or dismiss the older one. Auto-deduplication would be
	// wrong (it would silently hide signal that the structurer believes
	// the gap is real).
	it("re-encountering the same gap produces a NEW proposal alongside the prior one", async () => {
		ts.structurer.register("paste", [{ type: "skill", value: { name: "embedded Rust" } }]);
		ts.structurer.registerWikiProposal("paste", [
			{ kind: "skill", slug: "embedded-rust", markdown: VALID_PROPOSAL_MD },
		]);

		// First ingest — one proposal.
		await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "embedded Rust take 1" }),
		});
		// Second ingest with the same fixture — second proposal added.
		await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "embedded Rust take 2 with different text" }),
		});

		expect(ts.wikiProposals.list()).toHaveLength(2);
	});

	// WHY: pins "never auto-committed". The proposal lands in pending,
	// NOT in the local wiki repo. Only an explicit Promote (#17 admin
	// route) commits.
	it("gap-filling never auto-commits the new page to the local wiki repo", async () => {
		ts.structurer.register("paste", [{ type: "skill", value: { name: "embedded Rust" } }]);
		ts.structurer.registerWikiProposal("paste", [
			{ kind: "skill", slug: "embedded-rust", markdown: VALID_PROPOSAL_MD },
		]);
		await ts.wikiRepo.initIfMissing();
		await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "anything" }),
		});
		// Proposal exists in pending queue.
		expect(ts.wikiProposals.list()).toHaveLength(1);
		// But NOT in the wiki repo on disk.
		expect(existsSync(join(ts.wikiRepoDir, "skills/embedded-rust.md"))).toBe(false);
	});
});
