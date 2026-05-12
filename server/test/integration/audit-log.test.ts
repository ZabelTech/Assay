// §9.4 — Audit log is candidate-private; query_career also records sources consulted, not just returned.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../helpers/server.js";
import { defaultClaims, permissionedEmploymentClaim, privateCompensationClaim } from "../fixtures/claims.js";

describe("§9.4 audit logging", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ claims: defaultClaims });
	});
	afterEach(() => server.close());

	it("writes an entry per permissioned-data request with required fields", async () => {
		// WHY: §9.4 — every entry MUST include request_id, token_id, timestamp, claim_ids_returned.
		const { token, token_id } = server.issueToken({ audience_hint: "Acme", purpose: "Eng role" });
		await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});
		const entries = server.audit.list();
		expect(entries.length).toBeGreaterThanOrEqual(1);
		const e = entries.at(-1)!;
		expect(e.token_id).toBe(token_id);
		expect(e.audience_hint).toBe("Acme");
		expect(e.purpose).toBe("Eng role");
		expect(e.request_id).toMatch(/.+/);
		expect(e.timestamp).toMatch(/T/);
		expect(e.claim_ids_returned).toEqual(expect.any(Array));
	});

	it("records claim IDs returned by list_claims accurately", async () => {
		const { token } = server.issueToken();
		const res = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});
		const returned = res.body.result.claims.map((c: any) => c.claim_id).sort();
		const entry = server.audit.list().at(-1)!;
		expect([...entry.claim_ids_returned].sort()).toEqual(returned);
	});

	it("query_career records sources consulted, not only claims returned", async () => {
		// WHY: §9.4 — "the log entry MUST also record every source claim consulted during selection or
		// synthesis, not only the claim IDs returned to the requester." Visibility into server reasoning.
		const { token } = server.issueToken();
		await server.request({
			method: "tools/call",
			params: {
				name: "query_career",
				arguments: { information_needed: "tenure at Stripe" },
			},
			token,
		});
		const entry = server.audit.list().at(-1)!;
		expect((entry as any).claim_ids_consulted).toBeInstanceOf(Array);
		// Should include at least one permissioned claim that was considered for synthesis,
		// regardless of whether it appears in claim_ids_returned.
		expect((entry as any).claim_ids_consulted.length).toBeGreaterThanOrEqual(1);
	});

	it("does NOT include private claim IDs in claim_ids_returned even when they were filtered out", async () => {
		// WHY: §9 — private claims are NEVER returned. The audit log records what was returned, not what was hidden.
		const { token } = server.issueToken();
		await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});
		const entry = server.audit.list().at(-1)!;
		expect(entry.claim_ids_returned).not.toContain(privateCompensationClaim.claim_id);
	});

	it("audit log is not exposed via any MCP tool or resource", async () => {
		// WHY: §9.4 — "The audit log is candidate-private ... not exposed through any MCP tool or resource."
		// Querying agents have no way to inspect their own access pattern. Privacy goes both directions.
		const { token } = server.issueToken();
		await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});

		// No tool named audit/audit_log
		const toolsList = await server.request({ method: "tools/list" });
		const toolNames = toolsList.body.result.tools.map((t: any) => t.name);
		expect(toolNames.some((n: string) => n.includes("audit"))).toBe(false);

		// No resource URI containing audit
		const resList = await server.request({ method: "resources/list" });
		const resNames = resList.body.result.resources.map((r: any) => r.name);
		expect(resNames.some((n: string) => n.includes("audit"))).toBe(false);

		// Direct attempt to read cairn://audit returns an error
		const direct = await server.request({
			method: "resources/read",
			params: { uri: "cairn://audit" },
			token,
		});
		expect(direct.body.error).toBeDefined();
	});

	it("does not include the raw token value in audit entries", async () => {
		// WHY: §9.5 — "Servers MUST strip the token from their own access logs."
		const { token, token_id } = server.issueToken();
		await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});
		const entry = server.audit.list().at(-1)!;
		// token_id may be stored; raw token MUST NOT.
		const serialized = JSON.stringify(entry);
		expect(serialized).not.toContain(token);
		expect(entry.token_id).toBe(token_id);
	});

	it("logs requests against permissioned claims even when no token was provided", async () => {
		// Anonymous requests against permissioned data ALSO write audit entries so the candidate sees
		// scraping attempts. The token_id is recorded as the special "anonymous" marker (empty/null).
		await server.request({ method: "tools/call", params: { name: "list_claims", arguments: {} } });
		const entries = server.audit.list();
		expect(entries.length).toBeGreaterThanOrEqual(1);
	});
});
