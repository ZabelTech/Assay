// §9.5 — CORS guidance. Preflight allows Authorization; Allow-Credentials not true by default.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../helpers/server.js";

describe("§9.5 CORS", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({});
	});
	afterEach(() => server.close());

	it("OPTIONS preflight allows the Authorization request header", async () => {
		// WHY: §9.5 — clients that strip the URL token into the header form cannot complete cross-origin
		// requests without Allow-Headers: Authorization. This is the load-bearing CORS rule.
		const res = await server.rawFetch("/mcp", {
			method: "OPTIONS",
			headers: {
				origin: "https://example.com",
				"access-control-request-method": "POST",
				"access-control-request-headers": "authorization, content-type",
			},
		});
		const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
		expect(allowHeaders.toLowerCase()).toContain("authorization");
	});

	it("does not set Allow-Credentials true by default", async () => {
		// WHY: §9.5 — "Servers SHOULD NOT use Access-Control-Allow-Credentials: true." Cookies are not in
		// v0's auth model; turning this on would invite session-pinning bugs.
		const res = await server.rawFetch("/mcp", {
			method: "OPTIONS",
			headers: { origin: "https://example.com", "access-control-request-method": "POST" },
		});
		const allowCreds = res.headers.get("access-control-allow-credentials");
		expect(allowCreds === "true").toBe(false);
	});
});
