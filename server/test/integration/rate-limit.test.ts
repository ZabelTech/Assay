// §12 — rate-limit unauthenticated query_career to mitigate scraping; emit -32009 with retry_after.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../helpers/server.js";
import { defaultClaims } from "../fixtures/claims.js";

describe("§12 rate limiting", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({
			claims: defaultClaims,
			rateLimit: { window_ms: 60_000, max: 3 },
		});
	});
	afterEach(() => server.close());

	it("emits -32009 rate_limited when the unauth budget is exhausted", async () => {
		// WHY: §10.4 — rate_limited is the standard error; data.retry_after_seconds tells the client when to retry.
		for (let i = 0; i < 3; i++) {
			const ok = await server.request({
				method: "tools/call",
				params: { name: "query_career", arguments: { information_needed: "x" } },
			});
			expect(ok.body.error).toBeUndefined();
		}
		const blocked = await server.request({
			method: "tools/call",
			params: { name: "query_career", arguments: { information_needed: "x" } },
		});
		expect(blocked.body.error?.code).toBe(-32009);
		expect(blocked.body.error?.data?.retry_after_seconds).toBeGreaterThan(0);
	});

	it("does not rate-limit authenticated tokens at the unauth budget", async () => {
		// Authenticated tokens get their own budget; the unauth budget shouldn't bleed across.
		const { token } = server.issueToken();
		// Exhaust unauth budget
		for (let i = 0; i < 3; i++) {
			await server.request({
				method: "tools/call",
				params: { name: "query_career", arguments: { information_needed: "x" } },
			});
		}
		const authed = await server.request({
			method: "tools/call",
			params: { name: "query_career", arguments: { information_needed: "x" } },
			token,
		});
		expect(authed.body.error).toBeUndefined();
	});
});
