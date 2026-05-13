// #7 admin audit-log read (§9.4). Drive a few MCP requests to populate audit, then assert
// the admin endpoint surfaces them with optional filters.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

interface AuditResponse {
	entries: Array<{
		request_id: string;
		token_id: string | null;
		tool: string;
		timestamp: string;
		audience_hint?: string;
		purpose?: string;
		claim_ids_returned: string[];
	}>;
}

describe("#7 admin audit-log read", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: true });
	});
	afterEach(() => server.close());

	async function fire(token: string) {
		await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});
	}

	it("returns all entries for the candidate", async () => {
		const t1 = server.issueToken({ audience_hint: "alice" });
		const t2 = server.issueToken({ audience_hint: "bob" });
		await fire(t1.token);
		await fire(t2.token);
		await fire(t1.token);

		const res = await server.adminFetch("/admin/api/audit");
		expect(res.status).toBe(200);
		const body = (await res.json()) as AuditResponse;
		expect(body.entries.length).toBe(3);
	});

	it("filters by token_id", async () => {
		const t1 = server.issueToken({ audience_hint: "alice" });
		const t2 = server.issueToken({ audience_hint: "bob" });
		await fire(t1.token);
		await fire(t2.token);
		await fire(t1.token);

		const res = await server.adminFetch(`/admin/api/audit?token_id=${t1.token_id}`);
		const body = (await res.json()) as AuditResponse;
		expect(body.entries.length).toBe(2);
		expect(body.entries.every((e) => e.token_id === t1.token_id)).toBe(true);
	});

	it("filters by since (timestamp)", async () => {
		const t = server.issueToken();
		await fire(t.token);
		const midpoint = new Date().toISOString();
		// Small delay so the second entry has a strictly-later timestamp.
		await new Promise((r) => setTimeout(r, 10));
		await fire(t.token);

		const res = await server.adminFetch(`/admin/api/audit?since=${encodeURIComponent(midpoint)}`);
		const body = (await res.json()) as AuditResponse;
		expect(body.entries.length).toBeGreaterThanOrEqual(1);
		expect(body.entries.every((e) => e.timestamp >= midpoint)).toBe(true);
	});

	it("rejects unauthenticated read", async () => {
		const res = await server.adminFetch("/admin/api/audit", { noAuth: true });
		expect(res.status).toBe(401);
	});
});
