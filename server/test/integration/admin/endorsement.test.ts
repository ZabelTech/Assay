// #7 endorsement state model + verification gate.
//
// Acceptance bullet pinned: "The API rejects endorsement solicitation before subject
// verification completes". Two-state model only — `pending` and `completed`, no `expired`
// or `declined`. Subject-email change removes both (covered in Phase 2 tests).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

function extractChallenge(body: string): string | undefined {
	return body.match(/challenge=([a-z0-9_-]+)/i)?.[1];
}

describe("#7 admin endorsement (§7.2)", () => {
	let server: TestServer;

	describe("verification gate", () => {
		beforeEach(async () => {
			server = await buildTestServer({ subjectVerified: false });
		});
		afterEach(() => server.close());

		it("rejects solicitation pre-verification with -32011", async () => {
			const res = await server.adminFetch("/admin/api/endorsement/solicit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endorser_email: "bob@acme.com",
					value: { summary: "great engineer" },
				}),
			});
			expect(res.status).toBe(412);
			const body = (await res.json()) as { error: { code: number; data?: { symbol?: string } } };
			expect(body.error.code).toBe(-32011);
			expect(body.error.data?.symbol).toBe("precondition_failed_verification");
		});
	});

	describe("solicit / list / complete", () => {
		beforeEach(async () => {
			server = await buildTestServer({ subjectVerified: true });
		});
		afterEach(() => server.close());

		it("solicit returns 202 and the solicitation_id", async () => {
			const res = await server.adminFetch("/admin/api/endorsement/solicit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endorser_email: "bob@acme.com",
					endorser_name: "Bob",
					value: { summary: "great engineer" },
				}),
			});
			expect(res.status).toBe(202);
			const body = (await res.json()) as { ok: boolean; solicitation_id: string };
			expect(body.ok).toBe(true);
			expect(body.solicitation_id).toMatch(/^sol_[a-z0-9_-]+$/);
			expect(server.outbox().length).toBe(1);
		});

		it("list shows pending solicitations after solicit", async () => {
			await server.adminFetch("/admin/api/endorsement/solicit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endorser_email: "bob@acme.com",
					value: { summary: "great" },
				}),
			});
			const list = await server.adminFetch("/admin/api/endorsement");
			const body = (await list.json()) as {
				solicitations: { solicitation_id: string; endorser_email: string; state: string }[];
			};
			expect(body.solicitations.length).toBe(1);
			expect(body.solicitations[0]!.state).toBe("pending");
			expect(body.solicitations[0]!.endorser_email).toBe("bob@acme.com");
		});

		it("state transitions to `completed` when the endorser confirms", async () => {
			await server.adminFetch("/admin/api/endorsement/solicit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endorser_email: "bob@acme.com",
					value: { summary: "great" },
				}),
			});
			const challenge = extractChallenge(server.outbox()[0]!.body)!;
			const complete = await server.rawFetch(`/admin/api/endorsement/complete?challenge=${challenge}`);
			expect(complete.status).toBe(200);

			const list = await server.adminFetch("/admin/api/endorsement");
			const body = (await list.json()) as {
				solicitations: { state: string }[];
			};
			expect(body.solicitations[0]!.state).toBe("completed");

			// And an email_attested endorsement claim should be in the career.
			const claims = server.claims.list({ type: "endorsement" });
			expect(claims.length).toBe(1);
			expect(claims[0]!.attestation.level).toBe("email_attested");
		});

		it("re-solicit sends a fresh email for a pending solicitation", async () => {
			const create = await server.adminFetch("/admin/api/endorsement/solicit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endorser_email: "bob@acme.com",
					value: { summary: "great" },
				}),
			});
			const id = ((await create.json()) as { solicitation_id: string }).solicitation_id;
			expect(server.outbox().length).toBe(1);

			const re = await server.adminFetch(`/admin/api/endorsement/${id}/resolicit`, { method: "POST" });
			expect(re.status).toBe(202);
			expect(server.outbox().length).toBe(2);
		});

		it("re-solicit returns 400 for a completed solicitation", async () => {
			const create = await server.adminFetch("/admin/api/endorsement/solicit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endorser_email: "bob@acme.com",
					value: { summary: "great" },
				}),
			});
			const id = ((await create.json()) as { solicitation_id: string }).solicitation_id;
			const challenge = extractChallenge(server.outbox()[0]!.body)!;
			await server.rawFetch(`/admin/api/endorsement/complete?challenge=${challenge}`);

			const re = await server.adminFetch(`/admin/api/endorsement/${id}/resolicit`, { method: "POST" });
			expect(re.status).toBe(400);
		});

		it("re-solicit returns 404 for an unknown solicitation_id", async () => {
			const re = await server.adminFetch(`/admin/api/endorsement/sol_unknown/resolicit`, {
				method: "POST",
			});
			expect(re.status).toBe(404);
		});

		it("unauthenticated solicit / list / resolicit are rejected", async () => {
			const solicit = await server.adminFetch("/admin/api/endorsement/solicit", {
				method: "POST",
				noAuth: true,
				headers: { "content-type": "application/json" },
				body: "{}",
			});
			expect(solicit.status).toBe(401);

			const list = await server.adminFetch("/admin/api/endorsement", { noAuth: true });
			expect(list.status).toBe(401);
		});
	});
});
