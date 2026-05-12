// §10 — MCP initialize handshake MUST advertise the same capabilities regardless of authentication state.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../helpers/server.js";
import { defaultClaims } from "../fixtures/claims.js";

const initPayload = {
	protocolVersion: "2025-06-18",
	capabilities: {},
	clientInfo: { name: "test", version: "0.0.0" },
};

describe("§10 initialize handshake", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ claims: defaultClaims });
	});
	afterEach(() => server.close());

	it("returns capabilities for an unauthenticated request", async () => {
		const res = await server.request({ method: "initialize", params: initPayload });
		expect(res.body.result?.capabilities).toBeDefined();
	});

	it("advertises identical capabilities across no-token / valid / expired / revoked", async () => {
		// WHY: §10 — "The MCP initialize handshake MUST advertise the same capabilities regardless
		// of authentication state." Hiding capabilities by auth-level leaks information and breaks clients.
		const noToken = await server.request({ method: "initialize", params: initPayload });
		const valid = server.issueToken();
		const validRes = await server.request({ method: "initialize", params: initPayload, token: valid.token });
		const expired = server.issueToken({ expires_at: new Date(Date.now() - 1000).toISOString() });
		const expiredRes = await server.request({ method: "initialize", params: initPayload, token: expired.token });
		const revoked = server.issueToken();
		server.tokens.revoke(revoked.token_id);
		const revokedRes = await server.request({ method: "initialize", params: initPayload, token: revoked.token });

		const cap = noToken.body.result?.capabilities;
		expect(cap).toBeDefined();
		expect(validRes.body.result?.capabilities).toEqual(cap);
		expect(expiredRes.body.result?.capabilities).toEqual(cap);
		expect(revokedRes.body.result?.capabilities).toEqual(cap);
	});

	it("returns protocolVersion the SDK negotiated", async () => {
		const res = await server.request({ method: "initialize", params: initPayload });
		expect(res.body.result?.protocolVersion).toBeDefined();
	});
});
