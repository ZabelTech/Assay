// Domain types. Mirror the spec — see /spec/cairn-v0.md §5–§9.

export type Visibility = "public" | "permissioned" | "private";

export interface SelfAttestation {
	level: "self_attested";
}

export interface EmailVerification {
	verification_id: string;
	verified_at: string;
	verifier_url: string;
	verifier_is_subject_host: boolean;
	challenge_method: string;
	payload_hash: string;
}

export interface EmailAttestation {
	level: "email_attested";
	endorser_email_domain: string;
	endorser_email_local?: string;
	endorser_name?: string;
	verification: EmailVerification;
}

export interface DerivedAttestation {
	level: "derived";
	derived_by: string;
	derived_at: string;
	method: string;
	derived_from: string[];
}

export type Attestation = SelfAttestation | EmailAttestation | DerivedAttestation;

export interface UrlEvidence {
	type: "url";
	url: string;
	label?: string;
}
export interface DocumentEvidence {
	type: "document";
	document_url: string;
	content_hash: string;
	media_type: string;
	label?: string;
	uploaded_at: string;
	extracted?: { method: string; fields: Record<string, unknown> };
	redactions?: string[];
}
export interface ImageEvidence {
	type: "image";
	image_url: string;
	content_hash: string;
	media_type: string;
	label?: string;
	uploaded_at: string;
	capture?: { captured_at?: string; device?: string; location_present: boolean };
}
export interface ScreenshotEvidence {
	type: "screenshot";
	image_url: string;
	content_hash: string;
	media_type: string;
	label?: string;
	uploaded_at: string;
	context?: string;
	redactions?: string[];
	claimed_authenticity?: "self_captured" | "received_from_third_party" | "extracted_from_archive";
}
export interface CustomEvidence {
	type: string; // x:custom_type
	[key: string]: unknown;
}

export type Evidence = UrlEvidence | DocumentEvidence | ImageEvidence | ScreenshotEvidence | CustomEvidence;

export interface Claim {
	claim_id: string;
	subject: string;
	type: string;
	value: Record<string, unknown>;
	evidence?: Evidence[];
	attestation: Attestation;
	visibility: Visibility;
	created_at: string;
	updated_at: string;
}

export interface Career {
	"@context": string[];
	schema_version: string;
	subject: string;
	updated_at: string;
	claims: Claim[];
}

export interface TokenRecord {
	token_id: string;
	expires_at: string;
	audience_hint?: string;
	purpose?: string;
	revoked: boolean;
	created_at: string;
}

export type TokenStatus =
	| { kind: "valid"; record: TokenRecord }
	| { kind: "invalid" }
	| { kind: "expired"; record: TokenRecord }
	| { kind: "revoked"; record: TokenRecord };

export interface AuditEntry {
	request_id: string;
	token_id: string | null;
	audience_hint?: string;
	purpose?: string;
	timestamp: string;
	tool: string;
	claim_ids_returned: string[];
	claim_ids_consulted?: string[];
}
