// #7 end-to-end acceptance test.
//
// Drives the full top-bullet acceptance criterion in one run:
//   "A scripted client can drive the full onboarding sequence end-to-end against the admin
//    API. Test setup plants the initial subject email via the admin bootstrap path, then
//    the scripted client: triggers verification → completes verification → picks handle
//    (hosted) → authors claims via direct authoring, LinkedIn OAuth, GitHub OAuth, PDF
//    upload, and text paste → attaches at least one evidence object of each type to a
//    claim → solicits at least one endorsement → issues a token → lists tokens →
//    revokes a token → reads audit log".
//
// OAuth providers are mocked (separate #7 acceptance line). PDF parser is mocked. LLM
// Structurer is mocked.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { MockOAuthProvider } from "../../../src/adapters/oauth.js";
import type { Claim } from "../../../src/domain/types.js";

function extractChallenge(body: string): string {
	const m = body.match(/challenge=([a-z0-9_-]+)/i);
	if (!m) throw new Error("no challenge in mail body");
	return m[1]!;
}

describe("#7 end-to-end acceptance", () => {
	let server: TestServer;
	beforeEach(async () => {
		// The default helper seeds the subject (equivalent to `cairn admin bootstrap
		// --subject alice@example.com`). subjectVerified=false starts the e2e at the
		// realistic pre-verification state.
		server = await buildTestServer({ subjectVerified: false, operatorType: "hosted" });
	});
	afterEach(() => server.close());

	it("drives the full onboarding sequence end-to-end", async () => {
		// 1. Pre-verification state checks: serving and token issuance refused.
		const preServe = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
		});
		expect(preServe.body.error?.code).toBe(-32007); // subject_unverified

		const preToken = await server.adminFetch("/admin/api/tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(preToken.status).toBe(412); // precondition_failed_verification

		// 2. Verification: start → consume challenge → complete.
		await server.adminFetch("/admin/api/subject/verify/start", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: server.subject, method: "click_through_link" }),
		});
		const challenge = extractChallenge(server.outbox()[0]!.body);
		const verifyRes = await server.rawFetch(`/admin/api/subject/verify/complete?challenge=${challenge}`);
		expect(verifyRes.status).toBe(200);

		// 3. Pick handle (hosted).
		const handleRes = await server.adminFetch("/admin/api/handle", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle: "alice" }),
		});
		expect(handleRes.status).toBe(200);

		// 4a. Direct authoring.
		const directRes = await server.adminFetch("/admin/api/claims", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "identity", value: { name: "Alice", headline: "Senior engineer" } }),
		});
		expect(directRes.status).toBe(201);

		// 4b. LinkedIn OAuth.
		const linkedin = server.oauthProviders.get("linkedin") as MockOAuthProvider;
		linkedin.registerProfile("mock-linkedin-li-1", "linkedin profile blob");
		server.structurer.register("linkedin", [
			{ type: "employment", value: { employer: "Stripe", title: "Senior Engineer" } },
		]);
		const linkedinStart = await server.adminFetch("/admin/api/import/oauth/linkedin/start", {
			method: "POST",
		});
		const linkedinState = ((await linkedinStart.json()) as { state: string }).state;
		const linkedinCallback = await server.adminFetch(
			`/admin/api/import/oauth/linkedin/callback?code=li-1&state=${encodeURIComponent(linkedinState)}`,
		);
		const linkedinDrafts = (await linkedinCallback.json()) as {
			drafts: { draft_id: string }[];
		};

		// 4c. GitHub OAuth.
		const gh = server.oauthProviders.get("github") as MockOAuthProvider;
		gh.registerProfile("mock-github-gh-1", "github profile blob");
		server.structurer.register("github", [
			{
				type: "project",
				value: { name: "field-notes", url: "https://github.com/alice/field-notes" },
			},
		]);
		const ghStart = await server.adminFetch("/admin/api/import/oauth/github/start", { method: "POST" });
		const ghState = ((await ghStart.json()) as { state: string }).state;
		const ghCallback = await server.adminFetch(
			`/admin/api/import/oauth/github/callback?code=gh-1&state=${encodeURIComponent(ghState)}`,
		);
		const ghDrafts = (await ghCallback.json()) as { drafts: { draft_id: string }[] };

		// 4d. PDF upload.
		server.structurer.register("pdf", [
			{ type: "education", value: { institution: "UC Berkeley", credential: "B.S. CS" } },
		]);
		const pdfRes = await server.adminFetch("/admin/api/import/pdf", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data_base64: Buffer.from("resume text").toString("base64") }),
		});
		const pdfDrafts = (await pdfRes.json()) as { drafts: { draft_id: string }[] };

		// 4e. Text paste.
		server.structurer.register("paste", [
			{
				type: "narrative",
				value: { text: "Built and shipped distributed systems for 5+ years", scope: "career_summary" },
			},
		]);
		const pasteRes = await server.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "Built and shipped distributed systems for 5+ years" }),
		});
		const pasteDrafts = (await pasteRes.json()) as { drafts: { draft_id: string }[] };

		// Publish all drafts atomically.
		const publishIds = [
			...linkedinDrafts.drafts,
			...ghDrafts.drafts,
			...pdfDrafts.drafts,
			...pasteDrafts.drafts,
		].map((d) => d.draft_id);
		const publishRes = await server.adminFetch("/admin/api/drafts/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ draft_ids: publishIds }),
		});
		const publishBody = (await publishRes.json()) as { claim_ids: string[] };
		expect(publishBody.claim_ids.length).toBe(4);
		const evidenceTargetClaim = publishBody.claim_ids[0]!;

		// 5. Attach one of each evidence type to a claim.
		const evidenceAttachments = [
			{ type: "url", url: "https://github.com/alice/field-notes" },
			{
				type: "document",
				data_base64: Buffer.from("a pdf document").toString("base64"),
				media_type: "application/pdf",
				label: "Offer letter",
			},
			{
				type: "image",
				data_base64: Buffer.from("an image").toString("base64"),
				media_type: "image/jpeg",
				label: "Conference badge",
				capture: { captured_at: "2024-06-01T00:00:00Z", location_present: false },
			},
			{
				type: "screenshot",
				data_base64: Buffer.from("a screenshot").toString("base64"),
				media_type: "image/png",
				context: "Slack #engineering",
				claimed_authenticity: "self_captured",
			},
		];
		for (const body of evidenceAttachments) {
			const res = await server.adminFetch(`/admin/api/claims/${evidenceTargetClaim}/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			expect(res.status).toBe(201);
		}
		const enriched = server.claims.get(evidenceTargetClaim)!;
		expect(enriched.evidence?.length).toBe(4);

		// 6. Solicit an endorsement → consume challenge → assert email_attested claim landed.
		const solicitRes = await server.adminFetch("/admin/api/endorsement/solicit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				endorser_email: "bob@stripe.com",
				endorser_name: "Bob",
				value: { endorser_name: "Bob", summary: "Strong tech lead" },
			}),
		});
		expect(solicitRes.status).toBe(202);
		const endorsementChallenge = extractChallenge(server.outbox().at(-1)!.body);
		const completeRes = await server.rawFetch(
			`/admin/api/endorsement/complete?challenge=${endorsementChallenge}`,
		);
		expect(completeRes.status).toBe(200);
		const endorsementClaim = server.claims.list({ type: "endorsement" })[0];
		expect(endorsementClaim?.attestation.level).toBe("email_attested");

		// 7. Issue → list → revoke → list (revoked entry still present); drive MCP with it.
		const issued = await server.adminFetch("/admin/api/tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ audience_hint: "recruiter@acme.com", purpose: "interviews" }),
		});
		expect(issued.status).toBe(201);
		const { token, token_id } = (await issued.json()) as { token: string; token_id: string };

		const listBefore = await server.adminFetch("/admin/api/tokens");
		const listBeforeBody = (await listBefore.json()) as { tokens: { token_id: string; revoked: boolean }[] };
		const before = listBeforeBody.tokens.find((t) => t.token_id === token_id)!;
		expect(before.revoked).toBe(false);

		// Drive an MCP query_career through the issued token (creates audit entries).
		const mcpRes = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
			token,
		});
		expect(mcpRes.body.error).toBeUndefined();

		await server.adminFetch(`/admin/api/tokens/${token_id}`, { method: "DELETE" });
		const listAfter = await server.adminFetch("/admin/api/tokens");
		const listAfterBody = (await listAfter.json()) as { tokens: { token_id: string; revoked: boolean }[] };
		const after = listAfterBody.tokens.find((t) => t.token_id === token_id)!;
		expect(after.revoked).toBe(true);

		// 8. Read the audit log; assert it contains the MCP request we made.
		const audit = await server.adminFetch("/admin/api/audit");
		const auditBody = (await audit.json()) as {
			entries: { token_id: string | null; tool: string }[];
		};
		expect(auditBody.entries.some((e) => e.token_id === token_id && e.tool === "list_claims")).toBe(true);
	});
});
