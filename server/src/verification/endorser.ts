// §7.2 — Endorser email verification. Yields an email_attested endorsement claim with payload_hash.
import { createHash, randomBytes } from "node:crypto";
import type { Claim, EmailAttestation } from "../domain/types.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { Mailer } from "../adapters/mailer.js";

// Structural deps so both BuildAppDeps and admin-layer deps can call in.
interface EndorserDeps {
	subjects: SubjectRepo;
	claims: ClaimsRepo;
	mailer: Mailer;
	operatorUrl: string;
	subject: string;
}

export async function handleEndorsementStart(
	deps: EndorserDeps,
	body: { endorser_email?: string; endorser_name?: string; value?: unknown },
): Promise<{ ok: boolean; solicitation_id?: string }> {
	if (!body.endorser_email || typeof body.value !== "object" || body.value == null) {
		return { ok: false };
	}
	const { challenge, solicitation_id } = deps.subjects.createEndorsementChallenge({
		endorser_email: body.endorser_email,
		endorser_name: body.endorser_name,
		value: body.value,
	});
	const valueAny = body.value as Record<string, unknown>;
	const summary = typeof valueAny.summary === "string" ? valueAny.summary : "";
	const currentSubject = deps.subjects.getCurrentSubject() ?? deps.subject;
	const link = `${deps.operatorUrl}/admin/api/endorsement/complete?challenge=${challenge}`;
	await deps.mailer.send({
		to: body.endorser_email,
		subject: `Confirm endorsement for ${currentSubject}`,
		body: `You have been asked to endorse ${currentSubject}. The endorsement text reads:\n\n${summary}\n\nConfirm: ${link}\n`,
	});
	return { ok: true, solicitation_id };
}

export function handleEndorsementComplete(
	deps: EndorserDeps,
	input: { challenge?: string; discloseLocal?: boolean },
): boolean {
	if (!input.challenge) return false;
	const consumed = deps.subjects.consumeEndorsementChallenge(input.challenge);
	if (!consumed) return false;

	const [local, domain] = consumed.endorser_email.split("@");
	if (!local || !domain) return false;
	const value = consumed.value as Record<string, unknown>;
	const claim_id = `clm_endorsement_${randomBytes(6).toString("hex")}`;
	const payload_hash = `sha256:${canonicalizeForHash(value)}`;
	const now = new Date().toISOString();
	// #7 dynamic subject: endorsements attach to the current subject email at completion time.
	const currentSubject = deps.subjects.getCurrentSubject() ?? deps.subject;

	const attestation: EmailAttestation = {
		level: "email_attested",
		endorser_email_domain: domain,
		endorser_name: consumed.endorser_name ?? undefined,
		verification: {
			verification_id: `vfy_email_${randomBytes(6).toString("hex")}`,
			verified_at: now,
			verifier_url: deps.operatorUrl,
			verifier_is_subject_host: true,
			challenge_method: "click_through_link",
			payload_hash,
		},
	};
	if (input.discloseLocal) {
		attestation.endorser_email_local = local;
	}

	const claim: Claim = {
		claim_id,
		subject: currentSubject,
		type: "endorsement",
		value: value as Record<string, unknown>,
		attestation,
		visibility: "permissioned",
		created_at: now,
		updated_at: now,
	};
	deps.claims.insert(claim);
	return true;
}

// Canonicalization for payload_hash. RFC 8785-style: deterministic key sort, no whitespace.
export function canonicalizeForHash(value: unknown): string {
	const canonical = JSON.stringify(value, sortReplacer);
	return createHash("sha256").update(canonical).digest("hex");
}

function sortReplacer(_key: string, val: unknown): unknown {
	if (val && typeof val === "object" && !Array.isArray(val)) {
		const sorted: Record<string, unknown> = {};
		for (const k of Object.keys(val as Record<string, unknown>).sort()) {
			sorted[k] = (val as Record<string, unknown>)[k];
		}
		return sorted;
	}
	return val;
}
