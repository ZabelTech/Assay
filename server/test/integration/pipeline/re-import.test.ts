// #15 re-import scenarios. Pins:
//
// - "Re-importing the same source produces a new corpus + raw version;
//    existing published claims are unchanged; new drafts flow through the
//    review queue."
// - "Re-import contradiction: re-importing a source whose new corpus
//    version contradicts an existing published claim emits a ConflictRecord
//    with one kind:'draft' and one kind:'published' contender into the
//    reconciliation queue."
//
// The detector itself is pinned in unit/pipeline/contradiction.test.ts.
// Here we drive the same path through the full pipeline so the wiring +
// persistence + admin-API visibility are all proven together.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

interface DraftsResponse {
	drafts: Array<{ draft_id: string }>;
}
interface PublishResponse {
	claim_ids: string[];
}

let ts: TestServer;
beforeEach(async () => {
	ts = await buildTestServer();
});
afterEach(() => ts.close());

describe("#15 re-import: existing published claims are unchanged", () => {
	// WHY: pins the spec invariant "existing published claims are
	// unchanged" on re-import. Without this, a candidate's career could
	// be silently rewritten by a stale-source ingestion, defeating the
	// review-before-publish gate.
	it("re-importing paste leaves earlier published claims intact (only adds drafts to the queue)", async () => {
		ts.structurer.register("paste", [
			{ type: "skill", value: { name: "TypeScript" } },
		]);
		// First ingest + publish — lands a claim.
		const firstImport = await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "I know TypeScript fluently" }),
		});
		const firstDrafts = ((await firstImport.json()) as DraftsResponse).drafts;
		const firstPub = await ts.adminFetch("/admin/api/drafts/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ draft_ids: firstDrafts.map((d) => d.draft_id) }),
		});
		const firstClaimId = ((await firstPub.json()) as PublishResponse).claim_ids[0]!;
		const before = ts.claims.get(firstClaimId)!;

		// Second ingest — re-imports paste with different text. Should NOT
		// touch the existing published claim; it should only add a new
		// draft to the review queue.
		await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "Different TypeScript phrasing in version two" }),
		});
		const after = ts.claims.get(firstClaimId)!;
		expect(after).toEqual(before);
		// Original claim still in the served claims list.
		expect(ts.claims.list().map((c) => c.claim_id)).toContain(firstClaimId);
	});
});

describe("#15 re-import contradiction end-to-end", () => {
	// WHY: pins the load-bearing acceptance bullet for re-import
	// contradiction detection. Without it, a candidate could re-import an
	// employment record with a different employer and silently overwrite
	// history — the conflict surface is the candidate's reconciliation
	// queue, exposed via admin/api/conflicts.
	it("re-import that contradicts a published employment claim emits a draft+published conflict", async () => {
		// 1. Publish an employment claim via a paste ingest.
		ts.structurer.register("paste", [
			{
				type: "employment",
				value: {
					employer: "AcmeRival",
					title: "Senior Engineer",
					start_date: "2020-01-01",
					end_date: "2022-01-01",
					status: "ended",
				},
			},
		]);
		const importA = await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "I worked at AcmeRival as Senior Engineer 2020-2022" }),
		});
		const draftsA = ((await importA.json()) as DraftsResponse).drafts;
		const pubA = await ts.adminFetch("/admin/api/drafts/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ draft_ids: draftsA.map((d) => d.draft_id) }),
		});
		expect(pubA.status).toBe(201);

		// 2. Re-register the fixture with a CONTRADICTING employer for the
		//    same time window, then re-import. The deterministic detector
		//    should emit a ConflictRecord with both contender kinds.
		ts.structurer.register("paste", [
			{
				type: "employment",
				value: {
					employer: "AcmePeer",
					title: "Senior Engineer",
					start_date: "2020-06-01",
					end_date: "2021-12-01",
					status: "ended",
				},
			},
		]);
		await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "Re-import with different employer text" }),
		});

		// 3. The conflict appears in the admin-API reconciliation queue with
		//    one draft contender and one published contender.
		const conflictsRes = await ts.adminFetch("/admin/api/conflicts");
		const body = (await conflictsRes.json()) as {
			conflicts: { conflict_id: string; contenders: { kind: string }[] }[];
		};
		expect(body.conflicts.length).toBeGreaterThanOrEqual(1);
		const kinds = body.conflicts[0]!.contenders.map((c) => c.kind).sort();
		expect(kinds).toEqual(["draft", "published"]);
	});
});
