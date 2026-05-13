// #15 deterministic re-import contradiction detector. When a new draft of
// type=employment / education / etc. overlaps an already-published claim in
// the candidate's career *and* their value text differs in the same temporal
// slot, the pipeline emits a ConflictRecord with one `draft` contender and
// one `published` contender. Resolved via the same reconciliation actions
// (`merge`, `keep_both`, `edit`, `drop`) as same-run cross-source conflicts.
//
// Strictly deterministic — no LLM. The heuristic is conservative: only
// considered for types that carry start/end timestamps in their `value`
// (employment, education). Everything else passes through.
import type { Claim } from "../domain/types.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { ConflictRecord, DraftInput } from "./types.js";

const TIME_BOUNDED_TYPES = new Set(["employment", "education"]);

export function detectContradictions(input: {
	subject: string;
	drafts: DraftInput[];
	claims: ClaimsRepo;
}): ConflictRecord[] {
	const conflicts: ConflictRecord[] = [];
	const existing = input.claims.list();

	for (const d of input.drafts) {
		if (!TIME_BOUNDED_TYPES.has(d.type)) continue;
		const dStart = pickDate(d.value.start_date);
		const dEnd = pickDate(d.value.end_date) ?? Number.POSITIVE_INFINITY;
		if (dStart === null) continue;

		for (const c of existing) {
			if (c.type !== d.type) continue;
			if (c.subject !== input.subject) continue;
			const cStart = pickDate((c.value as Record<string, unknown>).start_date);
			const cEnd = pickDate((c.value as Record<string, unknown>).end_date) ?? Number.POSITIVE_INFINITY;
			if (cStart === null) continue;

			// Date ranges overlap if dStart <= cEnd && cStart <= dEnd.
			if (dStart > cEnd || cStart > dEnd) continue;

			// Value-text differs: any string-typed field disagrees with the
			// existing claim. For employment we care about employer + title;
			// for education, institution + degree. Conservative: check a fixed
			// set of fields and only flag when at least one differs.
			if (!valuesDiffer(d.type, d.value, c.value as Record<string, unknown>)) continue;

			conflicts.push({
				rationale:
					`Re-import contradiction: new ${d.type} draft overlaps the published claim` +
					` ${c.claim_id} in time and has different value fields. Reconcile via merge,` +
					` keep_both, edit, or drop.`,
				contenders: [
					{ kind: "draft", draft: d },
					{ kind: "published", claim_id: c.claim_id },
				],
			});
		}
	}
	return conflicts;
}

function pickDate(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const t = Date.parse(value);
	return Number.isFinite(t) ? t : null;
}

function valuesDiffer(
	type: string,
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	const fields = FIELDS_BY_TYPE[type] ?? [];
	for (const f of fields) {
		const av = a[f];
		const bv = b[f];
		if (typeof av === "string" && typeof bv === "string" && av.trim().toLowerCase() !== bv.trim().toLowerCase()) {
			return true;
		}
	}
	return false;
}

const FIELDS_BY_TYPE: Record<string, string[]> = {
	employment: ["employer", "title"],
	education: ["institution", "degree"],
};
