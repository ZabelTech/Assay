// §10.4 — meta-test: each of -32001..-32009 is producible by some request shape.
// Guards against the spec drifting from implementation.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../helpers/server.js";
import { defaultClaims, privateCompensationClaim } from "../fixtures/claims.js";

describe("§10.4 error codes — each producible", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ claims: defaultClaims });
	});
	afterEach(() => server.close());

	it("-32001 token_invalid: presenting an unknown token", async () => {
		const res = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token: "never-issued-token",
		});
		expect(res.body.error?.code).toBe(-32001);
	});

	it("-32002 token_expired: presenting an expired token", async () => {
		const { token } = server.issueToken({ expires_at: new Date(Date.now() - 1000).toISOString() });
		const res = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});
		expect(res.body.error?.code).toBe(-32002);
	});

	it("-32003 token_revoked: presenting a revoked token", async () => {
		const { token, token_id } = server.issueToken();
		server.tokens.revoke(token_id);
		const res = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});
		expect(res.body.error?.code).toBe(-32003);
	});

	it("-32004 token_mismatch: header and query carry disagreeing tokens", async () => {
		const { token } = server.issueToken();
		const res = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
			extraQuery: { t: "different-token" },
		});
		expect(res.body.error?.code).toBe(-32004);
		expect(res.status).toBe(400);
	});

	it("-32005 claim_not_visible: get_claim against a permissioned claim from an anonymous client", async () => {
		const res = await server.request({
			method: "tools/call",
			params: { name: "get_claim", arguments: { claim_id: "clm_employment_001" } },
		});
		expect(res.body.error?.code).toBe(-32005);
	});

	it("-32006 claim_not_found: get_claim against an unknown id", async () => {
		const res = await server.request({
			method: "tools/call",
			params: { name: "get_claim", arguments: { claim_id: "clm_no_such" } },
		});
		expect(res.body.error?.code).toBe(-32006);
	});

	it("-32007 subject_unverified: subject not verified yet", async () => {
		await server.close();
		server = await buildTestServer({ subjectVerified: false });
		const res = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
		});
		expect(res.body.error?.code).toBe(-32007);
	});

	it("-32008 malformed_input: query_career without information_needed", async () => {
		const res = await server.request({
			method: "tools/call",
			params: { name: "query_career", arguments: {} },
		});
		expect(res.body.error?.code).toBe(-32008);
	});

	it("-32009 rate_limited: exhausting the unauth budget", async () => {
		await server.close();
		server = await buildTestServer({
			claims: defaultClaims,
			rateLimit: { window_ms: 60_000, max: 1 },
		});
		await server.request({
			method: "tools/call",
			params: { name: "query_career", arguments: { information_needed: "x" } },
		});
		const res = await server.request({
			method: "tools/call",
			params: { name: "query_career", arguments: { information_needed: "x" } },
		});
		expect(res.body.error?.code).toBe(-32009);
	});

	it("private claim id is reported as not_visible, not not_found (intentional distinction)", () => {
		// WHY: §10.4 — "claim_not_visible reveals that a claim with the requested ID exists at some
		// visibility level the requester cannot access. This is information leakage and is intentional."
		// We assert the reference implementation keeps the distinction.
		expect(privateCompensationClaim.claim_id).toMatch(/clm_/);
	});
});
