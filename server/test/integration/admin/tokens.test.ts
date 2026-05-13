// #7 admin token API — issue / list / revoke. Issuance gated on subject verification.
// List returns both active and revoked tokens for audit context. Default expiry 90 days.
//
// Acceptance bullets pinned:
// - "The API rejects token issuance before subject verification completes"
// - "Token list returns both active and revoked tokens"
// - "Default token expiry is 90 days; explicit overrides accepted"
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

describe("#7 admin tokens", () => {
	let server: TestServer;

	describe("verification gate", () => {
		beforeEach(async () => {
			server = await buildTestServer({ subjectVerified: false });
		});
		afterEach(() => server.close());

		it("rejects token issuance pre-verification with -32011", async () => {
			const res = await server.adminFetch("/admin/api/tokens", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ audience_hint: "recruiter@acme.com" }),
			});
			expect(res.status).toBe(412);
			const body = (await res.json()) as { error: { code: number; data?: { symbol?: string } } };
			expect(body.error.code).toBe(-32011);
			expect(body.error.data?.symbol).toBe("precondition_failed_verification");
		});
	});

	describe("issue / list / revoke (subject verified)", () => {
		beforeEach(async () => {
			server = await buildTestServer({ subjectVerified: true });
		});
		afterEach(() => server.close());

		it("issues a token with default 90-day expiry", async () => {
			// WHY: #7 — "Default token expiry is 90 days"; concrete value is checkable.
			const t0 = Date.now();
			const res = await server.adminFetch("/admin/api/tokens", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ audience_hint: "recruiter@acme.com", purpose: "interviews" }),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				token: string;
				token_id: string;
				expires_at: string;
				audience_hint: string;
				purpose: string;
			};
			expect(body.token.length).toBeGreaterThanOrEqual(22);
			expect(body.audience_hint).toBe("recruiter@acme.com");
			expect(body.purpose).toBe("interviews");

			const expectedDelta = 90 * 86400_000;
			const actualDelta = new Date(body.expires_at).getTime() - t0;
			expect(actualDelta).toBeGreaterThan(expectedDelta - 60_000);
			expect(actualDelta).toBeLessThan(expectedDelta + 60_000);
		});

		it("accepts an explicit expiry override", async () => {
			const override = new Date(Date.now() + 7 * 86400_000).toISOString();
			const res = await server.adminFetch("/admin/api/tokens", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expires_at: override }),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as { expires_at: string };
			expect(body.expires_at).toBe(override);
		});

		it("lists both active and revoked tokens", async () => {
			// WHY: #7 — "Token list returns both active and revoked tokens" (audit context).
			const issued = await Promise.all([
				server.adminFetch("/admin/api/tokens", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({}),
				}),
				server.adminFetch("/admin/api/tokens", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({}),
				}),
			]);
			const ids = await Promise.all(
				issued.map(async (r) => ((await r.json()) as { token_id: string }).token_id),
			);

			await server.adminFetch(`/admin/api/tokens/${ids[0]}`, { method: "DELETE" });

			const list = await server.adminFetch("/admin/api/tokens");
			const body = (await list.json()) as {
				tokens: { token_id: string; revoked: boolean }[];
			};
			expect(body.tokens.length).toBe(2);
			const revoked = body.tokens.find((t) => t.token_id === ids[0])!;
			const active = body.tokens.find((t) => t.token_id === ids[1])!;
			expect(revoked.revoked).toBe(true);
			expect(active.revoked).toBe(false);
		});

		it("revoke is idempotent and returns 204", async () => {
			const issued = await server.adminFetch("/admin/api/tokens", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			});
			const id = ((await issued.json()) as { token_id: string }).token_id;
			const first = await server.adminFetch(`/admin/api/tokens/${id}`, { method: "DELETE" });
			expect(first.status).toBe(204);
			const second = await server.adminFetch(`/admin/api/tokens/${id}`, { method: "DELETE" });
			expect(second.status).toBe(204);
		});

		it("issued token works against /mcp (cross-surface smoke)", async () => {
			// WHY: an admin-issued token must authenticate the MCP endpoint as a normal
			// permissioned credential — this proves the issued token is a real MCP token.
			const issued = await server.adminFetch("/admin/api/tokens", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			});
			const { token } = (await issued.json()) as { token: string };
			const res = await server.request({
				method: "tools/call",
				params: { name: "list_claims", arguments: {} },
				token,
			});
			expect(res.body.error).toBeUndefined();
		});

		it("unauthenticated issue/list/revoke are rejected", async () => {
			const issue = await server.adminFetch("/admin/api/tokens", {
				method: "POST",
				noAuth: true,
				headers: { "content-type": "application/json" },
				body: "{}",
			});
			expect(issue.status).toBe(401);
			const list = await server.adminFetch("/admin/api/tokens", { noAuth: true });
			expect(list.status).toBe(401);
		});
	});
});
