// §10.2.1 — identity resource: returns the subject's identity claim, unauthenticated.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { defaultClaims, identityClaim } from "../../fixtures/claims.js";

describe("§10.2.1 identity resource", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ claims: defaultClaims });
	});
	afterEach(() => server.close());

	it("returns the identity claim to an anonymous reader", async () => {
		const res = await server.request({
			method: "resources/read",
			params: { uri: "cairn://identity" },
		});
		const content = res.body.result?.contents?.[0];
		expect(content).toBeDefined();
		const parsed = JSON.parse(content.text);
		expect(parsed.claim_id).toBe(identityClaim.claim_id);
		expect(parsed.value.name).toBe("Alice Chen");
	});

	it("returns the same identity to an authenticated reader", async () => {
		// WHY: identity is by design `public`; auth state doesn't change it.
		const { token } = server.issueToken();
		const res = await server.request({
			method: "resources/read",
			params: { uri: "cairn://identity" },
			token,
		});
		const parsed = JSON.parse(res.body.result.contents[0].text);
		expect(parsed.claim_id).toBe(identityClaim.claim_id);
	});

	it("returns an error when no identity claim has been published", async () => {
		await server.close();
		server = await buildTestServer({ claims: [] });
		const res = await server.request({
			method: "resources/read",
			params: { uri: "cairn://identity" },
		});
		// WHY: §6.2 — career object SHOULD contain exactly one identity claim. Absence is a configuration issue,
		// not a privacy violation; surface it loudly.
		expect(res.body.error).toBeDefined();
	});
});
