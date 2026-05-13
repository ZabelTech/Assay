// #7 admin subject lifecycle — start / resend / complete verification, GET current subject,
// and change-email with cascade (rewrite self_attested subjects, remove email_attested claims,
// remove pending endorsement solicitations).
//
// Acceptance bullets pinned:
// - "A change-email request that completes verification rewrites `subject` on every existing
//    `self_attested` claim; `email_attested` claims and pending endorsement solicitations are
//    removed and must be re-solicited"
// - "Resend and change-email controls are exercised by the test"
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import type { Claim } from "../../../src/domain/types.js";

function extractChallenge(body: string): string | undefined {
	return body.match(/challenge=([a-z0-9_-]+)/i)?.[1];
}

function selfAttestedClaim(claim_id: string, subject: string, type = "skill"): Claim {
	return {
		claim_id,
		subject,
		type,
		value: { name: "test" },
		attestation: { level: "self_attested" },
		visibility: "permissioned",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
	} as Claim;
}

function emailAttestedClaim(claim_id: string, subject: string): Claim {
	return {
		claim_id,
		subject,
		type: "endorsement",
		value: { endorser_name: "Bob", text: "great" },
		attestation: {
			level: "email_attested",
			endorser_email_domain: "acme.com",
			verification: {
				verification_id: "vfy_test",
				verified_at: "2026-01-01T00:00:00Z",
				verifier_url: "https://test.invalid",
				verifier_is_subject_host: true,
				challenge_method: "click_through_link",
				payload_hash: "sha256:deadbeef",
			},
		},
		visibility: "permissioned",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
	} as Claim;
}

describe("#7 admin subject lifecycle", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: false });
	});
	afterEach(() => server.close());

	describe("GET /admin/api/subject", () => {
		it("returns the current subject + verified=false on first read", async () => {
			const res = await server.adminFetch("/admin/api/subject");
			expect(res.status).toBe(200);
			const body = (await res.json()) as { email: string; verified: boolean };
			expect(body.email).toBe(server.subject);
			expect(body.verified).toBe(false);
		});

		it("rejects unauthenticated", async () => {
			const res = await server.adminFetch("/admin/api/subject", { noAuth: true });
			expect(res.status).toBe(401);
		});
	});

	describe("verify start / resend / complete", () => {
		it("start sends a challenge email; resend issues a fresh challenge", async () => {
			const start = await server.adminFetch("/admin/api/subject/verify/start", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: server.subject, method: "click_through_link" }),
			});
			expect(start.status).toBe(202);
			expect(server.outbox().length).toBe(1);
			const c1 = extractChallenge(server.outbox()[0]!.body);
			expect(c1).toBeDefined();

			const resend = await server.adminFetch("/admin/api/subject/verify/resend", {
				method: "POST",
			});
			expect(resend.status).toBe(202);
			expect(server.outbox().length).toBe(2);
			const c2 = extractChallenge(server.outbox()[1]!.body);
			expect(c2).toBeDefined();
			expect(c2).not.toBe(c1);
		});

		it("resend before start is rejected with 400", async () => {
			const resend = await server.adminFetch("/admin/api/subject/verify/resend", {
				method: "POST",
			});
			expect(resend.status).toBe(400);
		});

		it("complete via challenge GET (no auth — challenge is the credential)", async () => {
			await server.adminFetch("/admin/api/subject/verify/start", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: server.subject, method: "click_through_link" }),
			});
			const challenge = extractChallenge(server.outbox()[0]!.body)!;
			const complete = await server.rawFetch(`/admin/api/subject/verify/complete?challenge=${challenge}`);
			expect(complete.status).toBe(200);

			const after = await server.adminFetch("/admin/api/subject");
			const body = (await after.json()) as { verified: boolean };
			expect(body.verified).toBe(true);
		});

		it("all admin endpoints reject missing bearer", async () => {
			const calls: Array<[string, string]> = [
				["GET", "/admin/api/subject"],
				["POST", "/admin/api/subject/verify/start"],
				["POST", "/admin/api/subject/verify/resend"],
				["POST", "/admin/api/subject/change-email"],
			];
			for (const [method, path] of calls) {
				const res = await server.adminFetch(path, { method, noAuth: true });
				expect(res.status).toBe(401);
			}
		});
	});

	describe("change-email with cascade", () => {
		const oldEmail = "alice@example.com";
		const newEmail = "alice@newdomain.com";

		beforeEach(async () => {
			// Verify current subject first (change-email only makes sense post-verification).
			await server.adminFetch("/admin/api/subject/verify/start", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: oldEmail, method: "click_through_link" }),
			});
			const c = extractChallenge(server.outbox()[0]!.body)!;
			await server.rawFetch(`/admin/api/subject/verify/complete?challenge=${c}`);

			// Seed a few claims of each attestation level + a pending endorsement.
			server.claims.insert(selfAttestedClaim("clm_self_1", oldEmail, "skill"));
			server.claims.insert(selfAttestedClaim("clm_self_2", oldEmail, "employment"));
			server.claims.insert(emailAttestedClaim("clm_email_1", oldEmail));
			server.subjects.createEndorsementChallenge({
				endorser_email: "bob@acme.com",
				endorser_name: "Bob",
				value: { text: "endorsement payload" },
			});
		});

		it("change-email triggers a fresh challenge against the new address", async () => {
			const res = await server.adminFetch("/admin/api/subject/change-email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ new_email: newEmail }),
			});
			expect(res.status).toBe(202);

			// Mail should go to the new address.
			const mail = server.outbox().at(-1)!;
			expect(mail.to).toBe(newEmail);
		});

		it("change takes effect only on successful verification of the new email", async () => {
			await server.adminFetch("/admin/api/subject/change-email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ new_email: newEmail }),
			});

			// Before completion, the current subject is still the old email.
			const before = await server.adminFetch("/admin/api/subject");
			const beforeBody = (await before.json()) as { email: string };
			expect(beforeBody.email).toBe(oldEmail);

			// Complete the challenge for the new email.
			const challenge = extractChallenge(server.outbox().at(-1)!.body)!;
			const complete = await server.rawFetch(`/admin/api/subject/verify/complete?challenge=${challenge}`);
			expect(complete.status).toBe(200);

			const after = await server.adminFetch("/admin/api/subject");
			const afterBody = (await after.json()) as { email: string; verified: boolean };
			expect(afterBody.email).toBe(newEmail);
			expect(afterBody.verified).toBe(true);
		});

		it("on successful change, self_attested claims have subject rewritten atomically", async () => {
			await server.adminFetch("/admin/api/subject/change-email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ new_email: newEmail }),
			});
			const challenge = extractChallenge(server.outbox().at(-1)!.body)!;
			await server.rawFetch(`/admin/api/subject/verify/complete?challenge=${challenge}`);

			const self1 = server.claims.get("clm_self_1");
			const self2 = server.claims.get("clm_self_2");
			expect(self1?.subject).toBe(newEmail);
			expect(self2?.subject).toBe(newEmail);
		});

		it("on successful change, email_attested claims are removed", async () => {
			await server.adminFetch("/admin/api/subject/change-email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ new_email: newEmail }),
			});
			const challenge = extractChallenge(server.outbox().at(-1)!.body)!;
			await server.rawFetch(`/admin/api/subject/verify/complete?challenge=${challenge}`);

			expect(server.claims.get("clm_email_1")).toBeUndefined();
		});

		it("on successful change, pending endorsement solicitations are removed", async () => {
			await server.adminFetch("/admin/api/subject/change-email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ new_email: newEmail }),
			});
			const challenge = extractChallenge(server.outbox().at(-1)!.body)!;
			await server.rawFetch(`/admin/api/subject/verify/complete?challenge=${challenge}`);

			// The pending endorsement challenge seeded in beforeEach should be gone.
			const pendingRows = server.subjects[
				"db" as keyof typeof server.subjects
			] as unknown as { prepare: (sql: string) => { all: () => unknown[] } };
			const rows = pendingRows
				.prepare(`SELECT challenge FROM endorsement_challenges WHERE consumed = 0`)
				.all();
			expect(rows.length).toBe(0);
		});
	});
});
