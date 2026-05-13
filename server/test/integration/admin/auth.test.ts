// #7 admin auth — bearer-token surface for /admin/api/*, strictly separate from MCP token auth.
//
// Acceptance bullet pinned: "Admin API authentication is separate from MCP token authentication".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

describe("#7 admin auth (whoami)", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: false });
	});
	afterEach(() => server.close());

	it("rejects unauthenticated requests with -32010 unauthorized_admin", async () => {
		const res = await server.adminFetch("/admin/api/whoami", { noAuth: true });
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: number; data?: { symbol?: string } } };
		expect(body.error.code).toBe(-32010);
		expect(body.error.data?.symbol).toBe("unauthorized_admin");
	});

	it("accepts a valid admin bearer and returns the subject record", async () => {
		// WHY: whoami is the smallest surface to prove the auth middleware works end-to-end.
		const res = await server.adminFetch("/admin/api/whoami");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { subject: string; verified: boolean };
		expect(body.subject).toBe(server.subject);
		expect(body.verified).toBe(false);
	});

	it("rejects a wrong admin token", async () => {
		const res = await server.adminFetch("/admin/api/whoami", {
			noAuth: true,
			headers: { authorization: "Bearer not-a-real-token" },
		});
		expect(res.status).toBe(401);
	});

	it("rejects an MCP token presented as an admin bearer", async () => {
		// WHY: the two auth surfaces MUST NOT cross. A valid MCP permissioned token is
		// not a valid admin credential, even when transported in the same Authorization header.
		const { token: mcpToken } = server.issueToken();
		const res = await server.adminFetch("/admin/api/whoami", {
			noAuth: true,
			headers: { authorization: `Bearer ${mcpToken}` },
		});
		expect(res.status).toBe(401);
	});

	it("ignores an admin token presented as an MCP credential", async () => {
		// WHY: admin tokens authenticate /admin/api only. Sending one to /mcp must NOT
		// authenticate the request; the request looks unauthenticated to the MCP surface.
		// We assert this by hitting list_claims with the admin token in ?t= form and
		// observing the request is treated as anon (errors as -32001 token_invalid,
		// not as authenticated, and is not promoted to admin-level access).
		await server.subjects.markVerified(server.subject, { challenge_method: "test" });
		const res = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token: server.adminToken,
			tokenForm: "query",
		});
		// The admin token isn't a valid MCP token, so the MCP auth path treats it as invalid.
		expect(res.body.error?.code).toBe(-32001);
	});
});
