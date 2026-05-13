// #17 admin endpoints for pending wiki proposals. Tests drive the public API
// surface (list / get / promote / dismiss) and pin that the linter pre-commit
// hook still works through the route layer — a non-conforming proposal
// surfaces as a 400 with the linter's reason attached, not as a 500.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

const CONFORMING = `---
kind: skill
slug: rust
updated_at: 2026-05-01
sources:
  - https://example.com/rust-survey
related: []
---

## Signal

> sources: 1

- Memory safety without GC.
`;

const NON_CONFORMING = `---
kind: skill
slug: rust
updated_at: 2026-05-01
sources:
  - https://example.com/rust-survey
related: []
---

## Signal

No sources blockquote — linter must reject.
`;

let ts: TestServer;

beforeEach(async () => {
	ts = await buildTestServer();
	// Tests in this file actually exercise wiki promote, so the repo has to be
	// initialized. The shared helper deliberately leaves init lazy so the rest
	// of the suite doesn't pay for git init.
	await ts.wikiRepo.initIfMissing();
});
afterEach(() => {
	ts.close();
});

describe("admin/api/wiki/proposals (#17)", () => {
	// WHY: list must surface all pending proposals regardless of insertion
	// order. The pipeline (#15) inserts proposals; the admin UI consumes them.
	// Pins that the route exists and returns the JSON shape the UI expects.
	it("GET /admin/api/wiki/proposals lists pending proposals", async () => {
		ts.wikiProposals.create({ kind: "skill", slug: "rust", markdown: CONFORMING });
		ts.wikiProposals.create({ kind: "role", slug: "site-reliability-engineer", markdown: CONFORMING });

		const res = await ts.adminFetch("/admin/api/wiki/proposals");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { proposals: { slug: string }[] };
		expect(body.proposals.map((p) => p.slug).sort()).toEqual(["rust", "site-reliability-engineer"]);
	});

	// WHY: pins the three acceptance actions on a pending proposal — promote
	// (writes a commit), dismiss (deletes the row), ignore (default: leaves it).
	// The "ignore" action has no endpoint by design; not-promoting and not-
	// dismissing is the operation.
	it("promote a conforming proposal commits to the local wiki repo and removes it from the queue", async () => {
		const p = ts.wikiProposals.create({ kind: "skill", slug: "rust", markdown: CONFORMING });

		const res = await ts.adminFetch(`/admin/api/wiki/proposals/${p.proposal_id}/promote`, { method: "POST" });
		expect(res.status).toBe(201);
		const body = (await res.json()) as { commit_sha: string; path: string };
		expect(body.path).toBe("skills/rust.md");
		expect(body.commit_sha).toMatch(/^[0-9a-f]{40}$/);

		// File landed in the repo, proposal cleared from the queue.
		expect(existsSync(join(ts.wikiRepoDir, "skills/rust.md"))).toBe(true);
		expect(ts.wikiProposals.list()).toHaveLength(0);
	});

	// WHY: the linter pre-commit hook is the gate. A non-conforming proposal
	// must come back as a 400 with the linter's stderr reason — the candidate
	// needs to see what was wrong, not a generic 500.
	it("promote a non-conforming proposal surfaces a 400 with the linter reason", async () => {
		const p = ts.wikiProposals.create({ kind: "skill", slug: "rust", markdown: NON_CONFORMING });

		const res = await ts.adminFetch(`/admin/api/wiki/proposals/${p.proposal_id}/promote`, { method: "POST" });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: number; message: string } };
		expect(body.error.code).toBe(-32008); // malformed_input
		expect(body.error.message).toMatch(/wiki linter rejected/i);

		// Proposal stays in the queue so the candidate can fix and retry.
		expect(ts.wikiProposals.list()).toHaveLength(1);
		// File didn't land in the repo.
		expect(existsSync(join(ts.wikiRepoDir, "skills/rust.md"))).toBe(false);
	});

	// WHY: dismiss removes the proposal from the pending queue without touching
	// the wiki repo. The candidate uses this when the proposed page is wrong-
	// shaped or duplicative.
	it("DELETE /admin/api/wiki/proposals/:id removes the proposal", async () => {
		const p = ts.wikiProposals.create({ kind: "skill", slug: "rust", markdown: CONFORMING });

		const res = await ts.adminFetch(`/admin/api/wiki/proposals/${p.proposal_id}`, { method: "DELETE" });
		expect(res.status).toBe(204);
		expect(ts.wikiProposals.list()).toHaveLength(0);
		// Nothing committed to the wiki repo.
		expect(existsSync(join(ts.wikiRepoDir, "skills/rust.md"))).toBe(false);
	});

	// WHY: missing IDs must not 500 — they must come back as 404 with a clear
	// CairnError. Tests both promote and dismiss paths to keep the contract
	// uniform across actions.
	it("404 on unknown proposal id for promote and delete", async () => {
		const a = await ts.adminFetch(`/admin/api/wiki/proposals/wikip_missing/promote`, { method: "POST" });
		expect(a.status).toBe(404);
		const b = await ts.adminFetch(`/admin/api/wiki/proposals/wikip_missing`, { method: "DELETE" });
		expect(b.status).toBe(404);
	});

	// WHY: like every /admin/api/* route, the wiki-proposals routes are
	// strictly admin-bearer-gated. An MCP token (or no token) must come back
	// as 401, not be treated as authenticated.
	it("rejects requests without the admin bearer", async () => {
		const res = await ts.adminFetch("/admin/api/wiki/proposals", { noAuth: true });
		expect(res.status).toBe(401);
	});
});
