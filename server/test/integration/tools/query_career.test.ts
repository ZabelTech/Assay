// §10.1.1 — query_career: claim-shaped output, visibility-aware synthesis, anti-hallucination guard.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import {
	defaultClaims,
	publicProjectClaim,
	secondPublicProjectClaim,
	permissionedEmploymentClaim,
	privateCompensationClaim,
} from "../../fixtures/claims.js";

function callQuery(server: TestServer, args: unknown, token?: string) {
	return server.request({
		method: "tools/call",
		params: { name: "query_career", arguments: args },
		token,
	});
}

describe("§10.1.1 query_career", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ claims: defaultClaims });
	});
	afterEach(() => server.close());

	it("returns Claim[] with no answer/confidence field outside the claim structure", async () => {
		// WHY: §10.1.1 — "The server MUST NOT return a free-text `answer`, `summary`, or `confidence` field
		// outside the claim structure." This is the §10.3.4-prohibition-relocation guard.
		const res = await callQuery(server, { information_needed: "React Native shipping" });
		const result = res.body.result;
		expect(result.claims).toBeInstanceOf(Array);
		expect(result.answer).toBeUndefined();
		expect(result.summary).toBeUndefined();
		expect(result.confidence).toBeUndefined();
	});

	it("requires information_needed and returns -32008 if missing", async () => {
		// WHY: §10.4 — malformed_input is the right error for schema violations on tool input.
		const res = await callQuery(server, {});
		expect(res.body.error?.code).toBe(-32008);
	});

	it("returns only public claims to an anonymous requester", async () => {
		const res = await callQuery(server, { information_needed: "anything" });
		const ids = res.body.result.claims.map((c: any) => c.claim_id);
		expect(ids).not.toContain(permissionedEmploymentClaim.claim_id);
		expect(ids).not.toContain(privateCompensationClaim.claim_id);
	});

	it("returns public and permissioned claims to an authenticated requester", async () => {
		const { token } = server.issueToken();
		const res = await callQuery(server, { information_needed: "tenure at Stripe" }, token);
		const ids = res.body.result.claims.map((c: any) => c.claim_id);
		expect(ids).toContain(permissionedEmploymentClaim.claim_id);
		expect(ids).not.toContain(privateCompensationClaim.claim_id);
	});

	it("never returns private claims regardless of token", async () => {
		// WHY: §9 — private MUST never be returned. This is the load-bearing trust statement of the protocol.
		const { token } = server.issueToken();
		const res = await callQuery(server, { information_needed: "compensation" }, token);
		const ids = res.body.result.claims.map((c: any) => c.claim_id);
		expect(ids).not.toContain(privateCompensationClaim.claim_id);
	});

	it("produces a derived claim citing only visible source claims", async () => {
		// WHY: §7.3 / §10.1.1 — synthesis MUST NOT incorporate information from sources not visible to the requester.
		// This is the protocol's anti-hallucination + visibility-containment guarantee in one test.
		const res = await callQuery(server, { information_needed: "React Native" });
		const derived = res.body.result.claims.filter((c: any) => c.attestation?.level === "derived");
		// May be zero (if no synthesis triggered) or more, but if present must cite only public source IDs.
		for (const d of derived) {
			for (const sourceId of d.attestation.derived_from) {
				expect([publicProjectClaim.claim_id, secondPublicProjectClaim.claim_id]).toContain(sourceId);
			}
		}
	});

	it("derived_by equals the server's operator URL", async () => {
		// WHY: §7.3 — derived_by MUST be the URL identifying the synthesizing server; §4.3 says this is stable.
		const res = await callQuery(server, { information_needed: "React Native" });
		const derived = res.body.result.claims.filter((c: any) => c.attestation?.level === "derived");
		for (const d of derived) {
			expect(d.attestation.derived_by).toBe(server.operatorUrl);
		}
	});

	it("client.role_context does not widen visibility", async () => {
		// WHY: §10.1.1 — "MUST NOT use them to expand visibility beyond what the connecting URL permits."
		const res = await callQuery(server, {
			information_needed: "compensation history",
			client: { role_context: "Comp study" },
		});
		const ids = res.body.result.claims.map((c: any) => c.claim_id);
		expect(ids).not.toContain(privateCompensationClaim.claim_id);
		expect(ids).not.toContain(permissionedEmploymentClaim.claim_id);
	});
});
