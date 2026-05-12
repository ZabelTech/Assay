// #7 admin claim CRUD with email_attested.value immutability.
//
// Acceptance bullet pinned: "The API rejects `update` on the `value` field of `email_attested`
// claims; updates to `visibility` and other non-`value` fields are accepted".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import type { Claim } from "../../../src/domain/types.js";

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
				verification_id: "vfy_1",
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

describe("#7 admin claim CRUD", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: true });
	});
	afterEach(() => server.close());

	describe("create", () => {
		it("creates a self_attested claim with visibility default = permissioned (non-compensation)", async () => {
			const res = await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "skill", value: { name: "TypeScript" } }),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as { claim: Claim };
			expect(body.claim.attestation.level).toBe("self_attested");
			expect(body.claim.visibility).toBe("permissioned");
			expect(body.claim.subject).toBe(server.subject);
			expect(body.claim.claim_id).toBeDefined();
		});

		it("creates a compensation claim with visibility default = private", async () => {
			// WHY: #7 explicitly states `compensation` defaults to `private`.
			const res = await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "compensation",
					value: { type: "current_total", base: 180000, currency: "USD" },
				}),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as { claim: Claim };
			expect(body.claim.visibility).toBe("private");
		});

		it("accepts an explicit visibility override", async () => {
			const res = await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "skill", value: { name: "Rust" }, visibility: "public" }),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as { claim: Claim };
			expect(body.claim.visibility).toBe("public");
		});

		it("rejects direct creation of an email_attested claim", async () => {
			// WHY: #7 — "creation is exclusively via the endorsement solicitation flow (§7.2)".
			const res = await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "endorsement",
					value: { endorser_name: "Bob", text: "great" },
					attestation: { level: "email_attested" },
				}),
			});
			expect(res.status).toBe(400);
		});

		it("rejects custom claim types (§6.3 — out of scope for v0 admin API)", async () => {
			const res = await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "x:custom", value: { foo: "bar" } }),
			});
			expect(res.status).toBe(400);
		});

		it("rejects unauthenticated requests", async () => {
			const res = await server.adminFetch("/admin/api/claims", {
				method: "POST",
				noAuth: true,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "skill", value: { name: "x" } }),
			});
			expect(res.status).toBe(401);
		});
	});

	describe("list and get", () => {
		it("lists created claims with type filter", async () => {
			await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "skill", value: { name: "Go" } }),
			});
			await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "skill", value: { name: "Python" } }),
			});
			await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "compensation",
					value: { type: "current_total", base: 180000, currency: "USD" },
				}),
			});

			const all = await server.adminFetch("/admin/api/claims");
			const allBody = (await all.json()) as { claims: Claim[] };
			expect(allBody.claims.length).toBe(3);

			const skills = await server.adminFetch("/admin/api/claims?type=skill");
			const skillsBody = (await skills.json()) as { claims: Claim[] };
			expect(skillsBody.claims.length).toBe(2);
		});

		it("retrieves an individual claim", async () => {
			const created = await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "skill", value: { name: "Elixir" } }),
			});
			const id = ((await created.json()) as { claim: Claim }).claim.claim_id;

			const res = await server.adminFetch(`/admin/api/claims/${id}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { claim: Claim };
			expect(body.claim.claim_id).toBe(id);
		});

		it("returns 404 for unknown claim_id", async () => {
			const res = await server.adminFetch(`/admin/api/claims/clm_does_not_exist`);
			expect(res.status).toBe(404);
		});
	});

	describe("update", () => {
		it("updates value and visibility on a self_attested claim", async () => {
			const created = await server.adminFetch("/admin/api/claims", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "skill", value: { name: "TypeScript" } }),
			});
			const id = ((await created.json()) as { claim: Claim }).claim.claim_id;

			const res = await server.adminFetch(`/admin/api/claims/${id}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ value: { name: "Rust" }, visibility: "public" }),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { claim: Claim };
			expect((body.claim.value as { name: string }).name).toBe("Rust");
			expect(body.claim.visibility).toBe("public");
		});

		it("rejects value update on an email_attested claim with -32012 immutable_field", async () => {
			// WHY: #7 — "the `value` field is immutable on email_attested claims". The integrity
			// contract is payload_hash over value; mutating value would either silently invalidate
			// the hash (recruiter sees tampered claim) or — worse — recompute the hash and forge
			// an endorsement. Force the candidate to delete + re-solicit.
			const claim = emailAttestedClaim("clm_email_1", server.subject);
			server.claims.insert(claim);

			const res = await server.adminFetch(`/admin/api/claims/clm_email_1`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ value: { endorser_name: "Eve", text: "forged" } }),
			});
			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: { code: number; data?: { symbol?: string } } };
			expect(body.error.code).toBe(-32012);
			expect(body.error.data?.symbol).toBe("immutable_field");
		});

		it("accepts visibility update on an email_attested claim", async () => {
			// WHY: #7 — "Other fields (`visibility`, etc.) remain mutable since `payload_hash`
			// is computed only over `value`". Candidate can promote an endorsement to public.
			const claim = emailAttestedClaim("clm_email_2", server.subject);
			server.claims.insert(claim);

			const res = await server.adminFetch(`/admin/api/claims/clm_email_2`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ visibility: "public" }),
			});
			expect(res.status).toBe(200);
			const after = server.claims.get("clm_email_2");
			expect(after?.visibility).toBe("public");
			// Integrity invariant: value untouched.
			expect((after?.value as { text: string }).text).toBe("great");
		});

		it("returns 404 for unknown claim_id", async () => {
			const res = await server.adminFetch(`/admin/api/claims/clm_nope`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ visibility: "public" }),
			});
			expect(res.status).toBe(404);
		});
	});

	describe("delete", () => {
		it("removes any claim regardless of attestation level", async () => {
			const claim = emailAttestedClaim("clm_email_3", server.subject);
			server.claims.insert(claim);

			const res = await server.adminFetch(`/admin/api/claims/clm_email_3`, { method: "DELETE" });
			expect(res.status).toBe(204);
			expect(server.claims.get("clm_email_3")).toBeUndefined();
		});

		it("returns 404 for unknown claim_id", async () => {
			const res = await server.adminFetch(`/admin/api/claims/clm_nope`, { method: "DELETE" });
			expect(res.status).toBe(404);
		});
	});
});
