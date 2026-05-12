// §10.1.3 — get_claim: visibility-aware retrieval, distinct error codes for not_found vs not_visible.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import {
	defaultClaims,
	permissionedEmploymentClaim,
	privateCompensationClaim,
	publicProjectClaim,
} from "../../fixtures/claims.js";

function callGet(server: TestServer, claim_id: string, token?: string) {
	return server.request({
		method: "tools/call",
		params: { name: "get_claim", arguments: { claim_id } },
		token,
	});
}

describe("§10.1.3 get_claim", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ claims: defaultClaims });
	});
	afterEach(() => server.close());

	it("returns a public claim to an anonymous requester", async () => {
		const res = await callGet(server, publicProjectClaim.claim_id);
		expect(res.body.result.claim.claim_id).toBe(publicProjectClaim.claim_id);
	});

	it("returns -32006 claim_not_found for an unknown id", async () => {
		const res = await callGet(server, "clm_does_not_exist");
		expect(res.body.error?.code).toBe(-32006);
	});

	it("returns -32005 claim_not_visible for a permissioned claim accessed anonymously", async () => {
		// WHY: §10.4 — the spec deliberately distinguishes "exists but hidden" from "not found" to give
		// agents accurate signal. Servers MAY collapse, but our reference implementation keeps the distinction.
		const res = await callGet(server, permissionedEmploymentClaim.claim_id);
		expect(res.body.error?.code).toBe(-32005);
	});

	it("returns -32005 claim_not_visible for a private claim regardless of token", async () => {
		// WHY: §9 — private claims are NEVER returned. Even authenticated callers get not_visible.
		const { token } = server.issueToken();
		const res = await callGet(server, privateCompensationClaim.claim_id, token);
		expect(res.body.error?.code).toBe(-32005);
	});

	it("returns -32006 for a derived claim id from a prior query", async () => {
		// WHY: §10.1.3 — derived IDs are transient and MUST NOT be resolvable via get_claim.
		// We expect not_found rather than not_visible because the id never existed in storage.
		const res = await callGet(server, "clm_derived_transient_xyz");
		expect(res.body.error?.code).toBe(-32006);
	});

	it("returns the full claim with attestation and evidence intact", async () => {
		const { token } = server.issueToken();
		const res = await callGet(server, permissionedEmploymentClaim.claim_id, token);
		const claim = res.body.result.claim;
		expect(claim.value).toEqual(permissionedEmploymentClaim.value);
		expect(claim.attestation).toEqual(permissionedEmploymentClaim.attestation);
	});
});
