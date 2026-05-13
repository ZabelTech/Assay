// #15 conflicts reconciliation queue. Pins:
//
// - "Cross-source conflicts produce reconciliation queue entries visible to
//    the admin API; reconciliation actions (merge, keep_both, edit, drop)
//    are exercised by the test."
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

let ts: TestServer;
beforeEach(async () => {
	ts = await buildTestServer();
});
afterEach(() => ts.close());

describe("admin/api/conflicts (#15)", () => {
	// WHY: pins that conflicts written at ingest time are visible to the
	// admin API in the same shape the candidate review UI consumes. The
	// repo writes them; the route surface exposes them.
	it("GET /admin/api/conflicts returns pending conflicts for the subject", async () => {
		ts.conflicts.create({
			subject: ts.subject,
			rationale: "LinkedIn says Acme, resume says Acme Corp",
			contenders: [
				{ kind: "draft", draft: { type: "employment", value: { employer: "Acme" }, origin: [] } },
				{ kind: "draft", draft: { type: "employment", value: { employer: "Acme Corp" }, origin: [] } },
			],
		});

		const res = await ts.adminFetch("/admin/api/conflicts");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { conflicts: { conflict_id: string; rationale: string }[] };
		expect(body.conflicts).toHaveLength(1);
		expect(body.conflicts[0]!.rationale).toMatch(/Acme/);
	});

	// WHY: pins the four reconciliation actions named in #15. Each marks
	// the conflict resolved; the candidate then moves on. Drop also removes
	// the draft contender from the queue so the published claim stands
	// alone.
	it.each(["merge", "keep_both", "edit", "drop"] as const)(
		"POST /admin/api/conflicts/:id/resolve accepts action=%s",
		async (action) => {
			const id = ts.conflicts.create({
				subject: ts.subject,
				rationale: "test",
				contenders: [
					{ kind: "draft", draft: { type: "skill", value: { name: "X" }, origin: [] } },
					{ kind: "published", claim_id: "clm_published" },
				],
			});

			const res = await ts.adminFetch(`/admin/api/conflicts/${id}/resolve`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action }),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { resolution: string };
			expect(body.resolution).toBe(action);

			// After resolution, the conflict no longer appears in the
			// pending list.
			const after = await ts.adminFetch("/admin/api/conflicts");
			const list = ((await after.json()) as { conflicts: unknown[] }).conflicts;
			expect(list).toHaveLength(0);
		},
	);

	// WHY: unknown action must fail loud (rule 11). Accepting anything
	// would let a buggy UI silently mark conflicts resolved with no
	// recorded action — destroying audit value.
	it("rejects an unknown action", async () => {
		const id = ts.conflicts.create({
			subject: ts.subject,
			rationale: "test",
			contenders: [
				{ kind: "draft", draft: { type: "skill", value: { name: "X" }, origin: [] } },
				{ kind: "published", claim_id: "x" },
			],
		});
		const res = await ts.adminFetch(`/admin/api/conflicts/${id}/resolve`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "ignore" }),
		});
		expect(res.status).toBe(400);
	});
});
