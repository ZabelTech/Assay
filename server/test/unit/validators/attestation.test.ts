// §7 — Attestation level structural validation. v0 defines three: self_attested, email_attested, derived.
import { describe, expect, it } from "vitest";
import { parseAttestation } from "../../../src/domain/validators.js";

describe("§7.1 self_attested", () => {
	it("accepts level alone", () => {
		expect(() => parseAttestation({ level: "self_attested" })).not.toThrow();
	});
});

describe("§7.2 email_attested", () => {
	const ok = {
		level: "email_attested",
		endorser_email_domain: "acme.com",
		endorser_name: "Bob",
		verification: {
			verification_id: "vfy_001",
			verified_at: "2026-04-10T08:00:00Z",
			verifier_url: "https://assay.bot",
			verifier_is_subject_host: true,
			challenge_method: "click_through_link",
			payload_hash: "sha256:" + "a".repeat(64),
		},
	};
	it("accepts a complete email_attested attestation", () => {
		expect(() => parseAttestation(ok)).not.toThrow();
	});
	it("requires endorser_email_domain", () => {
		// WHY: §7.2 — domain MUST always be disclosed (local part is opt-in). No domain = no context.
		const { endorser_email_domain: _, ...rest } = ok;
		expect(() => parseAttestation(rest)).toThrow();
	});
	it("makes endorser_email_local optional", () => {
		// WHY: §7.2 — local part is OPTIONAL, disclosed only with endorser opt-in.
		expect(() => parseAttestation({ ...ok, endorser_email_local: undefined })).not.toThrow();
	});
	for (const f of ["verification_id", "verified_at", "verifier_url", "verifier_is_subject_host", "challenge_method", "payload_hash"]) {
		it(`requires verification.${f}`, () => {
			const { [f]: _, ...verification } = ok.verification as Record<string, unknown>;
			expect(() => parseAttestation({ ...ok, verification })).toThrow();
		});
	}
	it("rejects an unknown challenge_method outside x: namespace", () => {
		// WHY: §7.2.1 — known methods are click_through_link, code_return; signed_reply is v0.1 RFC.
		// Unknown methods MAY be supported via x: namespace; bare unknown values are malformed.
		expect(() =>
			parseAttestation({ ...ok, verification: { ...ok.verification, challenge_method: "signed_reply" } }),
		).toThrow();
	});
	it("accepts x:-namespaced challenge_method", () => {
		expect(() =>
			parseAttestation({ ...ok, verification: { ...ok.verification, challenge_method: "x:custom_proof" } }),
		).not.toThrow();
	});
	it("rejects a malformed payload_hash", () => {
		// WHY: integrity hashes are sha256:hex64 in v0; lax formats let claims drift silently.
		expect(() =>
			parseAttestation({ ...ok, verification: { ...ok.verification, payload_hash: "abc123" } }),
		).toThrow();
	});
});

describe("§7.3 derived", () => {
	const ok = {
		level: "derived",
		derived_by: "https://assay.bot",
		derived_at: "2026-05-10T14:32:00Z",
		method: "llm_selection_and_summary",
		derived_from: ["clm_a", "clm_b"],
	};
	it("accepts complete derived attestation", () => {
		expect(() => parseAttestation(ok)).not.toThrow();
	});
	for (const f of ["derived_by", "derived_at", "method", "derived_from"]) {
		it(`requires ${f}`, () => {
			const { [f]: _, ...rest } = ok as Record<string, unknown>;
			expect(() => parseAttestation(rest)).toThrow();
		});
	}
	it("rejects empty derived_from", () => {
		// WHY: §7.3 — derived claims MUST be supported by at least one source. Empty = fabricated content.
		expect(() => parseAttestation({ ...ok, derived_from: [] })).toThrow();
	});
});
