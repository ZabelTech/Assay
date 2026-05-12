// §10.1.2 — list_claims: filters, pagination, no derived claims, visibility enforcement.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { defaultClaims, permissionedEmploymentClaim, privateCompensationClaim } from "../../fixtures/claims.js";

function callList(server: TestServer, args: unknown = {}, token?: string) {
	return server.request({
		method: "tools/call",
		params: { name: "list_claims", arguments: args },
		token,
	});
}

describe("§10.1.2 list_claims", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ claims: defaultClaims });
	});
	afterEach(() => server.close());

	it("returns all public claims to anonymous requesters", async () => {
		const res = await callList(server);
		const ids = res.body.result.claims.map((c: any) => c.claim_id);
		expect(ids).not.toContain(permissionedEmploymentClaim.claim_id);
		expect(ids).not.toContain(privateCompensationClaim.claim_id);
	});

	it("returns public + permissioned when authenticated", async () => {
		const { token } = server.issueToken();
		const res = await callList(server, {}, token);
		const ids = res.body.result.claims.map((c: any) => c.claim_id);
		expect(ids).toContain(permissionedEmploymentClaim.claim_id);
		expect(ids).not.toContain(privateCompensationClaim.claim_id);
	});

	it("filters by type", async () => {
		const { token } = server.issueToken();
		const res = await callList(server, { type: "project" }, token);
		const types = new Set(res.body.result.claims.map((c: any) => c.type));
		expect(types).toEqual(new Set(["project"]));
	});

	it("paginates with limit and returns a next_cursor when more remain", async () => {
		const res = await callList(server, { limit: 2 });
		expect(res.body.result.claims.length).toBe(2);
		expect(res.body.result.next_cursor).toBeDefined();
	});

	it("resumes from cursor and yields the rest", async () => {
		const first = await callList(server, { limit: 1 });
		const cursor = first.body.result.next_cursor;
		const second = await callList(server, { limit: 10, cursor });
		const firstIds = new Set(first.body.result.claims.map((c: any) => c.claim_id));
		for (const c of second.body.result.claims) {
			expect(firstIds.has(c.claim_id)).toBe(false);
		}
	});

	it("excludes derived claims from output", async () => {
		// WHY: §10.1.2 — "Derived claims MUST NOT appear in list_claims output." Listing returns stored only.
		const res = await callList(server);
		for (const c of res.body.result.claims) {
			expect(c.attestation?.level).not.toBe("derived");
		}
	});
});
