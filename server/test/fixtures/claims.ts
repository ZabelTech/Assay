// Fixture claims used across tests. Each is a minimal-valid example of a §6.2 claim type.
import type { Claim } from "../../src/domain/types.js";

export const identityClaim: Claim = {
	claim_id: "clm_identity_001",
	subject: "alice@example.com",
	type: "identity",
	value: {
		name: "Alice Chen",
		headline: "Senior backend engineer, distributed systems",
		handles: { email: "alice@example.com" },
	},
	attestation: { level: "self_attested" },
	visibility: "public",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

export const publicProjectClaim: Claim = {
	claim_id: "clm_project_rn_001",
	subject: "alice@example.com",
	type: "project",
	value: {
		name: "Field Notes",
		summary: "Cross-platform note-taking app, React Native + Expo",
		role: "Sole engineer",
		started_at: "2022-04-01",
		ended_at: null,
		platforms: ["iOS", "Android", "Web"],
	},
	evidence: [{ type: "url", url: "https://github.com/alice/field-notes", label: "Source" }],
	attestation: { level: "self_attested" },
	visibility: "public",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

export const secondPublicProjectClaim: Claim = {
	claim_id: "clm_project_rn_002",
	subject: "alice@example.com",
	type: "project",
	value: {
		name: "Trail Tracker",
		summary: "React Native hiking GPS app",
		role: "Sole engineer",
		started_at: "2023-06-01",
		ended_at: "2024-02-01",
		platforms: ["iOS", "Android"],
	},
	attestation: { level: "self_attested" },
	visibility: "public",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

export const permissionedEmploymentClaim: Claim = {
	claim_id: "clm_employment_001",
	subject: "alice@example.com",
	type: "employment",
	value: {
		employer: "Stripe",
		title: "Senior Software Engineer",
		start_date: "2021-03-01",
		end_date: "2024-08-15",
		status: "ended",
		summary: "Worked on the financial reporting platform team.",
	},
	attestation: { level: "self_attested" },
	visibility: "permissioned",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

export const privateCompensationClaim: Claim = {
	claim_id: "clm_compensation_001",
	subject: "alice@example.com",
	type: "compensation",
	value: {
		type: "current_total",
		base: 165000,
		currency: "EUR",
		as_of: "2026-04-01",
	},
	attestation: { level: "self_attested" },
	visibility: "private",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

export const emailAttestedEndorsement: Claim = {
	claim_id: "clm_endorsement_001",
	subject: "alice@example.com",
	type: "endorsement",
	value: {
		endorser_name: "Bob Müller",
		endorser_role: "Engineering Manager",
		context_claim: "clm_employment_001",
		summary: "Alice led the migration of our core payments service.",
		relationship: "manager",
		worked_together_from: "2021-03-01",
		worked_together_until: "2024-08-15",
	},
	attestation: {
		level: "email_attested",
		endorser_email_domain: "stripe.com",
		endorser_name: "Bob Müller",
		verification: {
			verification_id: "vfy_email_001",
			verified_at: "2026-04-10T08:00:00Z",
			verifier_url: "https://test.invalid",
			verifier_is_subject_host: true,
			challenge_method: "click_through_link",
			payload_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
		},
	},
	visibility: "permissioned",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

export const defaultClaims: Claim[] = [
	identityClaim,
	publicProjectClaim,
	secondPublicProjectClaim,
	permissionedEmploymentClaim,
	privateCompensationClaim,
	emailAttestedEndorsement,
];
