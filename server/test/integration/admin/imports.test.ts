// #7 Phase 9 — admin import paths.
//
// Acceptance bullets pinned:
// - "All four import paths produce `self_attested` draft claims that the candidate edits
//    before publish"
// - "LinkedIn and GitHub OAuth providers are mocked in the automated test; real-provider
//    OAuth is verified out-of-band"
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { MockOAuthProvider, type OAuthProvider } from "../../../src/adapters/oauth.js";
import type { Claim } from "../../../src/domain/types.js";

interface DraftsResponse {
	drafts: Array<{
		draft_id: string;
		source: string;
		type: string;
		value: Record<string, unknown>;
		visibility: string;
	}>;
}

describe("#7 admin imports", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: true });
	});
	afterEach(() => server.close());

	describe("draft store + publish", () => {
		it("publish atomically moves drafts to claims as self_attested", async () => {
			// Seed a couple of drafts via the structurer + paste path so we can publish them.
			server.structurer.register("paste", [
				{ type: "skill", value: { name: "TypeScript" } },
				{ type: "skill", value: { name: "Rust" } },
			]);
			const importRes = await server.adminFetch("/admin/api/import/paste", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "any non-empty input" }),
			});
			const { drafts } = (await importRes.json()) as DraftsResponse;
			expect(drafts.length).toBe(2);

			const publish = await server.adminFetch("/admin/api/drafts/publish", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ draft_ids: drafts.map((d) => d.draft_id) }),
			});
			expect(publish.status).toBe(201);
			const result = (await publish.json()) as { claim_ids: string[] };
			expect(result.claim_ids.length).toBe(2);

			// Each is self_attested and attached to the current subject.
			for (const id of result.claim_ids) {
				const c = server.claims.get(id);
				expect(c?.attestation.level).toBe("self_attested");
				expect(c?.subject).toBe(server.subject);
			}
			// Drafts are gone after publish.
			const remaining = await server.adminFetch("/admin/api/drafts");
			expect(((await remaining.json()) as DraftsResponse).drafts.length).toBe(0);
		});

		it("publish rejects unknown draft_ids without partial write", async () => {
			server.structurer.register("paste", [{ type: "skill", value: { name: "Go" } }]);
			await server.adminFetch("/admin/api/import/paste", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "x" }),
			});

			const before = server.claims.list().length;
			const res = await server.adminFetch("/admin/api/drafts/publish", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ draft_ids: ["draft_does_not_exist"] }),
			});
			expect(res.status).toBe(400);
			expect(server.claims.list().length).toBe(before);
		});

		it("PUT updates a draft; DELETE removes it", async () => {
			server.structurer.register("paste", [{ type: "skill", value: { name: "Go" } }]);
			const importRes = await server.adminFetch("/admin/api/import/paste", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "x" }),
			});
			const draft_id = ((await importRes.json()) as DraftsResponse).drafts[0]!.draft_id;

			const put = await server.adminFetch(`/admin/api/drafts/${draft_id}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ value: { name: "Golang (edited)" } }),
			});
			expect(put.status).toBe(200);
			const after = (await put.json()) as { draft: { value: { name: string } } };
			expect(after.draft.value.name).toBe("Golang (edited)");

			const del = await server.adminFetch(`/admin/api/drafts/${draft_id}`, { method: "DELETE" });
			expect(del.status).toBe(204);
			const list = await server.adminFetch("/admin/api/drafts");
			expect(((await list.json()) as DraftsResponse).drafts.length).toBe(0);
		});
	});

	describe("text paste import", () => {
		it("creates self_attested drafts via the structurer", async () => {
			server.structurer.register("paste", [
				{ type: "narrative", value: { text: "10 years SWE", scope: "career_overview" } },
			]);
			const res = await server.adminFetch("/admin/api/import/paste", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "10 years SWE" }),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as DraftsResponse;
			expect(body.drafts.length).toBe(1);
			expect(body.drafts[0]!.source).toBe("paste");
			expect(body.drafts[0]!.type).toBe("narrative");
		});

		it("rejects empty text", async () => {
			const res = await server.adminFetch("/admin/api/import/paste", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "" }),
			});
			expect(res.status).toBe(400);
		});
	});

	describe("pdf import", () => {
		it("extracts text via PdfParser, drafts via Structurer", async () => {
			// #15: per-type validators now run at draft persist time; an
			// employment value missing required fields would fall back to a
			// narrative wrapper. Fixture must satisfy employmentValueZ.
			server.structurer.register("pdf", [
				{
					type: "employment",
					value: {
						employer: "Stripe",
						title: "Senior Engineer",
						start_date: "2022-01-01",
						status: "current",
					},
				},
			]);
			const pdfBytes = Buffer.from("résumé text content");
			const res = await server.adminFetch("/admin/api/import/pdf", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ data_base64: pdfBytes.toString("base64") }),
			});
			expect(res.status).toBe(201);
			const drafts = ((await res.json()) as DraftsResponse).drafts;
			expect(drafts[0]!.type).toBe("employment");
			expect(drafts[0]!.source).toBe("pdf");
		});
	});

	describe("oauth import (mocked)", () => {
		it("start returns authorize_url + state, callback completes via MockOAuthProvider", async () => {
			const linkedin = server.oauthProviders.get("linkedin") as MockOAuthProvider;
			linkedin.registerProfile("mock-linkedin-abc123", `{"name":"Alice","headline":"SWE"}`);
			server.structurer.register("linkedin", [
				{ type: "identity", value: { name: "Alice", headline: "SWE" } },
			]);

			const start = await server.adminFetch("/admin/api/import/oauth/linkedin/start", {
				method: "POST",
			});
			expect(start.status).toBe(200);
			const startBody = (await start.json()) as { authorize_url: string; state: string };
			expect(startBody.authorize_url).toContain("mock.linkedin.example");
			expect(startBody.state.length).toBeGreaterThan(8);

			const callback = await server.adminFetch(
				`/admin/api/import/oauth/linkedin/callback?code=abc123&state=${encodeURIComponent(startBody.state)}`,
			);
			expect(callback.status).toBe(201);
			const callbackBody = (await callback.json()) as DraftsResponse;
			expect(callbackBody.drafts[0]!.type).toBe("identity");
			expect(callbackBody.drafts[0]!.source).toBe("linkedin");
		});

		it("rejects state mismatch", async () => {
			const res = await server.adminFetch(
				"/admin/api/import/oauth/linkedin/callback?code=abc&state=unknown",
			);
			expect(res.status).toBe(400);
		});

		it("rejects state replay (single-use)", async () => {
			const linkedin = server.oauthProviders.get("linkedin") as MockOAuthProvider;
			linkedin.registerProfile("mock-linkedin-x", `{}`);
			server.structurer.register("linkedin", [
				{ type: "identity", value: { name: "x" } },
			]);
			const start = await server.adminFetch("/admin/api/import/oauth/linkedin/start", {
				method: "POST",
			});
			const { state } = (await start.json()) as { state: string };
			const first = await server.adminFetch(
				`/admin/api/import/oauth/linkedin/callback?code=x&state=${encodeURIComponent(state)}`,
			);
			expect(first.status).toBe(201);
			const replay = await server.adminFetch(
				`/admin/api/import/oauth/linkedin/callback?code=x&state=${encodeURIComponent(state)}`,
			);
			expect(replay.status).toBe(400);
		});

		it("works for the github provider too", async () => {
			const gh = server.oauthProviders.get("github") as MockOAuthProvider;
			gh.registerProfile("mock-github-y", `{"login":"alice"}`);
			server.structurer.register("github", [
				{ type: "project", value: { name: "field-notes", url: "https://github.com/alice/field-notes" } },
			]);
			const start = await server.adminFetch("/admin/api/import/oauth/github/start", { method: "POST" });
			const { state } = (await start.json()) as { state: string };
			const callback = await server.adminFetch(
				`/admin/api/import/oauth/github/callback?code=y&state=${encodeURIComponent(state)}`,
			);
			expect(callback.status).toBe(201);
			const drafts = ((await callback.json()) as DraftsResponse).drafts;
			expect(drafts[0]!.type).toBe("project");
			expect(drafts[0]!.source).toBe("github");
		});

		it("rejects unknown provider id", async () => {
			const res = await server.adminFetch("/admin/api/import/oauth/facebook/start", { method: "POST" });
			expect(res.status).toBe(400);
		});
	});

	describe("auth gating", () => {
		it("all import endpoints reject missing bearer", async () => {
			const calls: Array<[string, string]> = [
				["GET", "/admin/api/drafts"],
				["POST", "/admin/api/import/paste"],
				["POST", "/admin/api/import/pdf"],
				["POST", "/admin/api/import/oauth/linkedin/start"],
			];
			for (const [method, path] of calls) {
				const res = await server.adminFetch(path, { method, noAuth: true });
				expect(res.status).toBe(401);
			}
		});
	});
});
