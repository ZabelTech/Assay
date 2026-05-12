// Synthesizer adapter. v0 ships StubSynthesizer only; LLM-backed is a follow-up issue.
import type { Claim, DerivedAttestation } from "../domain/types.js";

export interface SynthesisRequest {
	information_needed: string;
	visible_claims: Claim[];
	subject: string;
	derived_by: string;
	role_context?: string;
}

export interface SynthesisResult {
	selected_claim_ids: string[];
	derived: Claim[];
	consulted_claim_ids: string[];
}

export interface Synthesizer {
	select(req: SynthesisRequest): SynthesisResult;
}

// StubSynthesizer: deterministic keyword-match selection + a single derived narrative claim summarizing
// the matched claims. derived_from is validated against the visible set — anything not visible is dropped
// (this is the §7.3 "no fabricated content" guarantee).
export class StubSynthesizer implements Synthesizer {
	select(req: SynthesisRequest): SynthesisResult {
		const terms = tokenize(req.information_needed).concat(tokenize(req.role_context ?? ""));
		const consulted: string[] = [];
		const matches: Claim[] = [];
		for (const claim of req.visible_claims) {
			consulted.push(claim.claim_id);
			const haystack = JSON.stringify(claim.value).toLowerCase();
			if (terms.some((t) => haystack.includes(t))) {
				matches.push(claim);
			}
		}

		// If nothing matched on terms, return all visible claims so the agent gets useful output;
		// agents can still inspect attestation levels per claim and weight accordingly.
		const selected = matches.length > 0 ? matches : req.visible_claims;
		const visibleIds = new Set(req.visible_claims.map((c) => c.claim_id));

		const derived: Claim[] = [];
		if (selected.length > 0) {
			const sourceIds = selected.map((c) => c.claim_id).filter((id) => visibleIds.has(id));
			if (sourceIds.length > 0) {
				const summary = summarize(req.information_needed, selected);
				const att: DerivedAttestation = {
					level: "derived",
					derived_by: req.derived_by,
					derived_at: new Date().toISOString(),
					method: "stub_keyword_match",
					derived_from: sourceIds,
				};
				derived.push({
					claim_id: `clm_derived_${cryptoIsh()}`,
					subject: req.subject,
					type: "narrative",
					value: { text: summary, scope: "synthesis" },
					attestation: att,
					visibility: "public",
					created_at: att.derived_at,
					updated_at: att.derived_at,
				});
			}
		}

		return {
			selected_claim_ids: selected.map((c) => c.claim_id),
			derived,
			consulted_claim_ids: consulted,
		};
	}
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 3);
}

function summarize(question: string, claims: Claim[]): string {
	const names = claims
		.map((c) => {
			const v = c.value as { name?: string; title?: string; employer?: string; summary?: string; text?: string };
			return v.name ?? v.title ?? v.employer ?? v.summary ?? v.text ?? c.claim_id;
		})
		.slice(0, 4);
	return `For "${question}": ${names.join(", ")}.`;
}

function cryptoIsh(): string {
	return Math.random().toString(36).slice(2, 12);
}
