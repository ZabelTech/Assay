// Zod schemas mirroring the spec. Validation failures become -32008 malformed_input upstream.
// Spec sections cited per schema.
import { z } from "zod";
import type { Attestation, Career, Claim, Evidence } from "./types.js";

// §4 — subject identifier MUST be an email.
const emailZ = z
	.string()
	.min(3)
	.refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "must be an email address" });

// §5 — Cairn v0 context MUST be present.
const CAIRN_V0_CONTEXT = "https://cairn.dev/schemas/v0";

// §8 — evidence types.
const sha256Z = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const urlEvidenceZ = z.object({
	type: z.literal("url"),
	url: z
		.string()
		.url()
		.refine((u) => /^https?:\/\//.test(u), { message: "url evidence must be http(s)" }),
	label: z.string().optional(),
});

const documentEvidenceZ = z.object({
	type: z.literal("document"),
	document_url: z.string().url(),
	content_hash: sha256Z,
	media_type: z.string().min(1),
	label: z.string().optional(),
	uploaded_at: z.string().min(1),
	extracted: z
		.object({ method: z.string(), fields: z.record(z.string(), z.unknown()) })
		.optional(),
	redactions: z.array(z.string()).optional(),
});

const imageCaptureZ = z
	.object({
		captured_at: z.string().optional(),
		device: z.string().optional(),
		location_present: z.boolean(),
	})
	.strict(); // §8.4: rejects raw GPS coordinate fields.

const imageEvidenceZ = z.object({
	type: z.literal("image"),
	image_url: z.string().url(),
	content_hash: sha256Z,
	media_type: z.string().min(1),
	label: z.string().optional(),
	uploaded_at: z.string().min(1),
	capture: imageCaptureZ.optional(),
});

const screenshotEvidenceZ = z.object({
	type: z.literal("screenshot"),
	image_url: z.string().url(),
	content_hash: sha256Z,
	media_type: z.string().min(1),
	label: z.string().optional(),
	uploaded_at: z.string().min(1),
	context: z.string().optional(),
	redactions: z.array(z.string()).optional(),
	claimed_authenticity: z
		.enum(["self_captured", "received_from_third_party", "extracted_from_archive"])
		.optional(),
});

// §8.1 — custom evidence via x: namespace.
const customEvidenceZ = z
	.object({ type: z.string().startsWith("x:") })
	.passthrough();

const evidenceZ: z.ZodType<Evidence> = z.union([
	urlEvidenceZ,
	documentEvidenceZ,
	imageEvidenceZ,
	screenshotEvidenceZ,
	customEvidenceZ,
]);

// §7 — attestation levels.
const selfAttestationZ = z.object({ level: z.literal("self_attested") });

const challengeMethodZ = z.union([
	z.literal("click_through_link"),
	z.literal("code_return"),
	z.string().startsWith("x:"),
]);

const emailVerificationZ = z.object({
	verification_id: z.string().min(1),
	verified_at: z.string().min(1),
	verifier_url: z.string().url(),
	verifier_is_subject_host: z.boolean(),
	challenge_method: challengeMethodZ,
	payload_hash: sha256Z,
});

const emailAttestationZ = z.object({
	level: z.literal("email_attested"),
	endorser_email_domain: z.string().min(1),
	endorser_email_local: z.string().optional(),
	endorser_name: z.string().optional(),
	verification: emailVerificationZ,
});

const derivedAttestationZ = z.object({
	level: z.literal("derived"),
	derived_by: z.string().url(),
	derived_at: z.string().min(1),
	method: z.string().min(1),
	derived_from: z.array(z.string()).min(1),
});

const attestationZ: z.ZodType<Attestation> = z.union([
	selfAttestationZ,
	emailAttestationZ,
	derivedAttestationZ,
]);

// §6.2 — per-type value schemas.
const identityValueZ = z.object({
	name: z.string().min(1),
	pronouns: z.string().optional(),
	headline: z.string().optional(),
	location: z.object({ city: z.string().optional(), country: z.string().optional() }).optional(),
	handles: z.record(z.string(), z.string()).optional(),
});

const employmentValueZ = z
	.object({
		employer: z.string().min(1),
		title: z.string().min(1),
		start_date: z.string().min(1),
		end_date: z.string().nullable().optional(),
		status: z.enum(["current", "ended", "undisclosed"]),
		summary: z.string().optional(),
	})
	.refine(
		(v) => {
			if (v.status === "current") return v.end_date == null;
			if (v.status === "ended") return typeof v.end_date === "string" && v.end_date.length > 0;
			return true; // undisclosed: end_date may be null or set
		},
		{ message: "end_date contradicts status" },
	);

const educationValueZ = z.object({
	institution: z.string().min(1),
	program: z.string().min(1),
	start_date: z.string().min(1),
	end_date: z.string().nullable().optional(),
});

const projectValueZ = z.object({
	name: z.string().min(1),
	summary: z.string().optional(),
	role: z.string().optional(),
	started_at: z.string().optional(),
	ended_at: z.string().nullable().optional(),
	platforms: z.array(z.string()).optional(),
});

const publicationValueZ = z.object({
	title: z.string().min(1),
	venue: z.string().optional(),
	url: z.string().optional(),
	year: z.number().optional(),
});

const credentialValueZ = z.object({
	name: z.string().min(1),
	issuer: z.string().min(1),
	issued_at: z.string().optional(),
	expires_at: z.string().nullable().optional(),
});

const skillValueZ = z.object({
	name: z.string().min(1),
	level: z.string().optional(),
	evidence_claims: z.array(z.string()).optional(),
});

const relationshipZ = z.union([
	z.enum(["manager", "report", "peer", "collaborator", "client", "mentor", "mentee"]),
	z.string().startsWith("x:"),
]);

const endorsementValueZ = z.object({
	endorser_name: z.string().min(1),
	endorser_role: z.string().optional(),
	context_claim: z.string().optional(),
	summary: z.string().min(1),
	relationship: relationshipZ.optional(),
	worked_together_from: z.string().optional(),
	worked_together_until: z.string().nullable().optional(),
});

const availabilityValueZ = z.object({
	status: z.string().min(1),
	role_types: z.array(z.string()).optional(),
	locations: z
		.object({ remote: z.boolean().optional(), cities: z.array(z.string()).optional() })
		.optional(),
	earliest_start: z.string().optional(),
	valid_until: z.string().optional(),
});

const preferenceValueZ = z.record(z.string(), z.unknown());

// ISO 4217 alphabetic codes are three uppercase letters; we approximate with a regex.
const iso4217Z = z.string().regex(/^[A-Z]{3}$/);

const compensationValueZ = z.object({
	type: z.enum(["target_total", "current_total", "historical"]),
	base: z.number().optional(),
	base_min: z.number().optional(),
	base_max: z.number().optional(),
	currency: iso4217Z,
	equity_required: z.boolean().optional(),
	equity_value_estimate: z.number().optional(),
	bonus_target: z.number().optional(),
	structure_notes: z.string().optional(),
	as_of: z.string().optional(),
});

const narrativeValueZ = z.object({
	text: z.string().min(1),
	scope: z.string().optional(),
});

const KNOWN_TYPE_VALUE: Record<string, z.ZodTypeAny> = {
	identity: identityValueZ,
	employment: employmentValueZ,
	education: educationValueZ,
	project: projectValueZ,
	publication: publicationValueZ,
	credential: credentialValueZ,
	skill: skillValueZ,
	endorsement: endorsementValueZ,
	availability: availabilityValueZ,
	preference: preferenceValueZ,
	compensation: compensationValueZ,
	narrative: narrativeValueZ,
};

const visibilityZ = z.enum(["public", "permissioned", "private"]);

const claimEnvelopeZ = z.object({
	claim_id: z.string().min(1),
	subject: emailZ,
	type: z.string().min(1),
	value: z.record(z.string(), z.unknown()),
	evidence: z.array(evidenceZ).optional(),
	attestation: attestationZ,
	visibility: visibilityZ,
	created_at: z.string().min(1),
	updated_at: z.string().min(1),
});

export function parseAttestation(input: unknown): Attestation {
	return attestationZ.parse(input);
}

export function parseEvidence(input: unknown): Evidence {
	return evidenceZ.parse(input);
}

export function parseClaim(input: unknown): Claim {
	const envelope = claimEnvelopeZ.parse(input);
	// Per-type value validation. Unknown types must be x:-namespaced (§6.3).
	if (envelope.type in KNOWN_TYPE_VALUE) {
		KNOWN_TYPE_VALUE[envelope.type]!.parse(envelope.value);
	} else if (!envelope.type.startsWith("x:")) {
		throw new z.ZodError([
			{
				code: "custom",
				path: ["type"],
				message: `unknown claim type "${envelope.type}" — custom types must use x: prefix`,
			},
		]);
	}
	return envelope as Claim;
}

const careerZ = z
	.object({
		"@context": z
			.array(z.string())
			.refine((ctx) => ctx.includes(CAIRN_V0_CONTEXT), { message: "@context must include Cairn v0" }),
		schema_version: z.literal("cairn/0.1"),
		subject: emailZ,
		updated_at: z.string().min(1),
		claims: z.array(z.unknown()),
	})
	.passthrough(); // §5 — ignore unknown top-level fields.

export function parseCareer(input: unknown): Career {
	const parsed = careerZ.parse(input);
	const claims = parsed.claims.map(parseClaim);
	return { ...parsed, claims } as Career;
}

// #7 handle validator (hosted deployments). RFC 1035 DNS label rules:
// - 1..63 chars
// - LDH set: ASCII letters, digits, hyphen
// - No leading or trailing hyphen
// Letters are lowercase by convention; we lowercase before validating so users can paste
// mixed-case input.
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function parseDnsLabel(input: unknown): string {
	if (typeof input !== "string") throw new Error("handle must be a string");
	const lower = input.toLowerCase();
	if (!DNS_LABEL.test(lower)) {
		throw new Error("handle must match RFC 1035 DNS label rules (a-z, 0-9, -; 1..63 chars; no leading/trailing hyphen)");
	}
	return lower;
}
