// #16 wiki usage tracking hook. Pins:
//
// - "Usage-tracking hook (for signal 2 above) is in place — i.e. when #15
//    consumes a wiki page, the event is recorded somewhere queryable, even
//    if the staleness-exemption logic isn't yet using it."
//
// The hook fires at publish time: for each claim the pipeline writes one
// (slug, claim_id, used_at) row to wiki_page_uses per slug the structurer
// reported consuming. v0 ships the data hook only; the staleness-exemption
// logic that READS from this table is later work.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { WikiPageUsesRepo } from "../../../src/storage/wiki_page_uses.repo.js";

interface DraftsResponse {
	drafts: Array<{ draft_id: string }>;
}

let ts: TestServer;
let uses: WikiPageUsesRepo;
beforeEach(async () => {
	ts = await buildTestServer();
	uses = new WikiPageUsesRepo((ts as unknown as { pipeline: { deps: { db: import("better-sqlite3").Database } } }).pipeline.deps.db);
});
afterEach(() => ts.close());

describe("#16 wiki_page_uses recording at publish", () => {
	// WHY: load-bearing for the future stale-by-use exemption. Without
	// this hook firing at publish, the eventual staleness logic has no
	// data to reason over. Pin the row count and shape now so a future
	// regression won't silently break the data.
	it("records one wiki_page_uses row per (slug, claim) when the structurer reports consumed slugs", async () => {
		ts.structurer.register("paste", [{ type: "skill", value: { name: "TypeScript" } }]);
		ts.structurer.registerConsumedWiki("paste", ["distributed-systems", "code-review"]);

		const importRes = await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "TypeScript is my main language" }),
		});
		const { drafts } = (await importRes.json()) as DraftsResponse;

		// Before publish: nothing in wiki_page_uses (the hook fires at
		// publish, not ingest, so we always know which claim_id to link).
		expect(uses.listForSlug("distributed-systems")).toEqual([]);

		const pubRes = await ts.adminFetch("/admin/api/drafts/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ draft_ids: drafts.map((d) => d.draft_id) }),
		});
		const { claim_ids } = (await pubRes.json()) as { claim_ids: string[] };

		// One row per (slug, claim). Both slugs the Mock reported get a
		// row pointing at the new claim.
		const dsRows = uses.listForSlug("distributed-systems");
		const crRows = uses.listForSlug("code-review");
		expect(dsRows).toHaveLength(1);
		expect(crRows).toHaveLength(1);
		expect(dsRows[0]!.claim_id).toBe(claim_ids[0]);
		expect(crRows[0]!.claim_id).toBe(claim_ids[0]);
		// used_at is an ISO timestamp (sanity check).
		expect(dsRows[0]!.used_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	// WHY: pin that the hook is a no-op when the structurer reports no
	// consumed slugs — most #7 tests fall into this path. A spurious row
	// here would pollute the eventual staleness analysis.
	it("records nothing when the structurer reports no consumed slugs", async () => {
		ts.structurer.register("paste", [{ type: "skill", value: { name: "Rust" } }]);
		// Deliberately no registerConsumedWiki call.
		const importRes = await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "Rust is the future" }),
		});
		const { drafts } = (await importRes.json()) as DraftsResponse;
		await ts.adminFetch("/admin/api/drafts/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ draft_ids: drafts.map((d) => d.draft_id) }),
		});
		// No slug → no rows for any slug.
		expect(uses.listForSlug("distributed-systems")).toEqual([]);
		expect(uses.listForSlug("staff-platform-engineer")).toEqual([]);
	});
});
