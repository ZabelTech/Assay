// Moment-in-time timestamp fields (created_at, updated_at, verified_at,
// derived_at, uploaded_at) MUST be ISO 8601 with offset. The previous
// `.string().min(1)` rule accepted "yesterday" and the parser would then
// blow up downstream — fail at the schema boundary instead.
import { describe, expect, it } from "vitest";
import { parseAttestation, parseClaim, parseEvidence } from "../../../src/domain/validators.js";

const baseClaim = {
	claim_id: "clm_1",
	subject: "alice@example.com",
	type: "skill",
	value: { name: "Rust" },
	attestation: { level: "self_attested" as const },
	visibility: "permissioned" as const,
};

describe("timestamp validation", () => {
	it("accepts ISO 8601 with Z and with offset", () => {
		// WHY: the spec's examples and the test fixtures use both forms; both
		// must keep working.
		expect(() =>
			parseClaim({
				...baseClaim,
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00+02:00",
			}),
		).not.toThrow();
	});

	it("rejects plain strings like 'yesterday' on created_at", () => {
		expect(() =>
			parseClaim({ ...baseClaim, created_at: "yesterday", updated_at: "2024-01-01T00:00:00Z" }),
		).toThrow();
	});

	it("rejects date-only values on moment-in-time fields", () => {
		// WHY: "2024-01-01" is a calendar date, not a moment. created_at means
		// "when did this row get written" — we need the time component.
		expect(() =>
			parseClaim({ ...baseClaim, created_at: "2024-01-01", updated_at: "2024-01-01T00:00:00Z" }),
		).toThrow();
	});

	it("rejects malformed ISO like month 13 on verified_at", () => {
		expect(() =>
			parseAttestation({
				level: "email_attested",
				endorser_email_domain: "acme.com",
				verification: {
					verification_id: "v1",
					verified_at: "2024-13-45T99:99:99Z",
					verifier_url: "https://example.com",
					verifier_is_subject_host: true,
					challenge_method: "click_through_link",
					payload_hash: "sha256:" + "0".repeat(64),
				},
			}),
		).toThrow();
	});

	it("rejects malformed timestamp on document evidence uploaded_at", () => {
		expect(() =>
			parseEvidence({
				type: "document",
				document_url: "https://example.com/doc.pdf",
				content_hash: "sha256:" + "0".repeat(64),
				media_type: "application/pdf",
				uploaded_at: "not-a-timestamp",
			}),
		).toThrow();
	});

	it("accepts a valid derived_at on derived attestation", () => {
		expect(() =>
			parseAttestation({
				level: "derived",
				derived_by: "https://example.com",
				derived_at: "2024-01-01T00:00:00Z",
				method: "llm_selection_and_summary",
				derived_from: ["clm_a"],
			}),
		).not.toThrow();
	});
});
