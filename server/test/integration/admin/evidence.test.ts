// #7 evidence attach/replace/remove on a claim, regardless of attestation level.
// Four types: url (reference), document/image/screenshot (uploaded). EXIF GPS gated
// behind explicit opt-in per spec §8.4.
//
// Acceptance bullet pinned: "attaches at least one evidence object of each type
// (`url`, `document`, `image`, `screenshot`) to a claim".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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

async function createSkill(server: TestServer): Promise<string> {
	const res = await server.adminFetch("/admin/api/claims", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "skill", value: { name: "TypeScript" } }),
	});
	return ((await res.json()) as { claim: Claim }).claim.claim_id;
}

const PDF_BYTES = "fake-pdf-bytes-for-test";
const PDF_BASE64 = Buffer.from(PDF_BYTES).toString("base64");
const PDF_HASH = `sha256:${createHash("sha256").update(PDF_BYTES).digest("hex")}`;

describe("#7 admin evidence (§8)", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: true });
	});
	afterEach(() => server.close());

	describe("attach", () => {
		it("attaches a `url` evidence (reference only — no content hash)", async () => {
			const id = await createSkill(server);
			const res = await server.adminFetch(`/admin/api/claims/${id}/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "url",
					url: "https://github.com/alice/repo",
					label: "Source repo",
				}),
			});
			expect(res.status).toBe(201);
			const after = server.claims.get(id)!;
			expect(after.evidence?.length).toBe(1);
			expect(after.evidence?.[0]).toMatchObject({
				type: "url",
				url: "https://github.com/alice/repo",
				label: "Source repo",
			});
		});

		it("attaches a `document` evidence with content hash and per-type metadata", async () => {
			const id = await createSkill(server);
			const res = await server.adminFetch(`/admin/api/claims/${id}/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "document",
					data_base64: PDF_BASE64,
					media_type: "application/pdf",
					label: "Offer letter",
					extracted: { employer: "Stripe", title: "Engineer" },
					redactions: ["compensation_amount"],
				}),
			});
			expect(res.status).toBe(201);
			const after = server.claims.get(id)!;
			const ev = after.evidence?.[0]! as Record<string, unknown>;
			expect(ev.type).toBe("document");
			expect(ev.content_hash).toBe(PDF_HASH);
			expect(ev.media_type).toBe("application/pdf");
			expect(ev.extracted).toEqual({ employer: "Stripe", title: "Engineer" });
			expect(ev.redactions).toEqual(["compensation_amount"]);
			expect(ev.document_url).toMatch(/^cairn:\/\/evidence\//);
			// Bytes themselves should NOT be inlined in the stored claim.
			expect("data_base64" in ev).toBe(false);
		});

		it("attaches an `image` evidence; raw GPS withheld unless include_gps=true", async () => {
			const id = await createSkill(server);
			const baseBody = {
				type: "image" as const,
				data_base64: PDF_BASE64,
				media_type: "image/jpeg",
				label: "Workplace badge",
				capture: {
					captured_at: "2023-11-04T09:14:00Z",
					device: "iPhone 14",
					location_present: true,
					raw_gps: { lat: 37.77, lon: -122.41 },
				},
			};

			// First attach: no opt-in. raw_gps stripped from stored evidence.
			const noOptIn = await server.adminFetch(`/admin/api/claims/${id}/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(baseBody),
			});
			expect(noOptIn.status).toBe(201);
			let ev = server.claims.get(id)!.evidence?.[0]! as Record<string, unknown>;
			expect((ev.capture as Record<string, unknown>).location_present).toBe(true);
			expect((ev.capture as Record<string, unknown>).raw_gps).toBeUndefined();

			// Replace with opt-in. raw_gps preserved.
			const optIn = await server.adminFetch(`/admin/api/claims/${id}/evidence/0`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...baseBody, include_gps: true }),
			});
			expect(optIn.status).toBe(200);
			ev = server.claims.get(id)!.evidence?.[0]! as Record<string, unknown>;
			expect((ev.capture as Record<string, unknown>).raw_gps).toEqual({ lat: 37.77, lon: -122.41 });
		});

		it("attaches a `screenshot` evidence with context + claimed_authenticity", async () => {
			const id = await createSkill(server);
			const res = await server.adminFetch(`/admin/api/claims/${id}/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "screenshot",
					data_base64: PDF_BASE64,
					media_type: "image/png",
					label: "Slack thread",
					context: "Slack #engineering",
					claimed_authenticity: "self_captured",
					redactions: ["other_participants"],
				}),
			});
			expect(res.status).toBe(201);
			const ev = server.claims.get(id)!.evidence?.[0]! as Record<string, unknown>;
			expect(ev.type).toBe("screenshot");
			expect(ev.context).toBe("Slack #engineering");
			expect(ev.claimed_authenticity).toBe("self_captured");
			expect(ev.redactions).toEqual(["other_participants"]);
			expect(ev.content_hash).toBe(PDF_HASH);
		});

		it("attaches evidence on an email_attested claim (no immutability conflict — payload_hash is over value only)", async () => {
			const claim = emailAttestedClaim("clm_email_1", server.subject);
			server.claims.insert(claim);
			const res = await server.adminFetch(`/admin/api/claims/clm_email_1/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "url", url: "https://example.org/proof" }),
			});
			expect(res.status).toBe(201);
			const after = server.claims.get("clm_email_1")!;
			expect(after.evidence?.length).toBe(1);
			// Integrity invariant: value untouched.
			expect((after.value as { text: string }).text).toBe("great");
		});

		it("rejects unauthenticated attach", async () => {
			const id = await createSkill(server);
			const res = await server.adminFetch(`/admin/api/claims/${id}/evidence`, {
				method: "POST",
				noAuth: true,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "url", url: "https://x" }),
			});
			expect(res.status).toBe(401);
		});

		it("404 on attach to a missing claim", async () => {
			const res = await server.adminFetch(`/admin/api/claims/clm_missing/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "url", url: "https://x" }),
			});
			expect(res.status).toBe(404);
		});
	});

	describe("replace and remove", () => {
		it("PUT replaces evidence at an index", async () => {
			const id = await createSkill(server);
			await server.adminFetch(`/admin/api/claims/${id}/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "url", url: "https://old" }),
			});
			const res = await server.adminFetch(`/admin/api/claims/${id}/evidence/0`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "url", url: "https://new" }),
			});
			expect(res.status).toBe(200);
			const ev = server.claims.get(id)!.evidence?.[0]! as Record<string, unknown>;
			expect(ev.url).toBe("https://new");
		});

		it("DELETE removes evidence at an index", async () => {
			const id = await createSkill(server);
			await server.adminFetch(`/admin/api/claims/${id}/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "url", url: "https://a" }),
			});
			await server.adminFetch(`/admin/api/claims/${id}/evidence`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "url", url: "https://b" }),
			});
			const res = await server.adminFetch(`/admin/api/claims/${id}/evidence/0`, { method: "DELETE" });
			expect(res.status).toBe(204);
			const after = server.claims.get(id)!;
			expect(after.evidence?.length).toBe(1);
			expect((after.evidence?.[0]! as Record<string, unknown>).url).toBe("https://b");
		});

		it("PUT/DELETE return 404 for out-of-range index", async () => {
			const id = await createSkill(server);
			const put = await server.adminFetch(`/admin/api/claims/${id}/evidence/0`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "url", url: "https://x" }),
			});
			expect(put.status).toBe(404);

			const del = await server.adminFetch(`/admin/api/claims/${id}/evidence/0`, { method: "DELETE" });
			expect(del.status).toBe(404);
		});
	});
});
