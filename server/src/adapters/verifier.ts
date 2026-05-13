// #15 publish-time provenance verification. The pipeline asks Verifier whether a
// draft's value text is grounded in the corpus files it cites. ok=false rejects
// the publish and surfaces `reason` to the candidate.
//
// Two concrete impls ship in this PR; a third (LlmVerifier) is documented as a
// gap per the user's "adapter-only LLM" decision.
//
// - SubstringVerifier — deterministic. Every string-typed field in
//   `draft.value` (recursively) must appear, case-insensitively, in at least
//   one cited corpus file's body. Non-string fields are passed through.
//   Strict, simple, no dependencies. The default in production.
//
// - PassThroughVerifier — always returns ok=true. Used in tests that don't
//   care about provenance (e.g. existing #7 import tests that use synthesized
//   fixture values not derived from the input text). The pipeline always has
//   `some` verifier — there is no opt-out — so this exists rather than being
//   left as null.
import type { CorpusFile, DraftInput } from "../pipeline/types.js";

export interface VerifierResult {
	ok: boolean;
	reason: string;
}

export interface Verifier {
	verify(input: { draft: DraftInput; cited_corpus: CorpusFile[] }): Promise<VerifierResult>;
}

export class SubstringVerifier implements Verifier {
	async verify(input: { draft: DraftInput; cited_corpus: CorpusFile[] }): Promise<VerifierResult> {
		const haystacks = input.cited_corpus.map((c) => c.body.toLowerCase());
		const needles = collectStrings(input.draft.value);
		for (const needle of needles) {
			const lc = needle.toLowerCase();
			if (lc.trim() === "") continue;
			if (!haystacks.some((h) => h.includes(lc))) {
				return {
					ok: false,
					reason: `value field text "${truncate(needle)}" is not present in any cited corpus file`,
				};
			}
		}
		return { ok: true, reason: "" };
	}
}

export class PassThroughVerifier implements Verifier {
	async verify(): Promise<VerifierResult> {
		return { ok: true, reason: "" };
	}
}

// Selection helper used by index.ts. Per #15's acceptance: LlmVerifier when
// ANTHROPIC_API_KEY is set, SubstringVerifier otherwise. With the "no concrete
// LLM impl" decision in this PR, the LlmVerifier branch falls through to
// SubstringVerifier regardless; that gap is documented in the PR description.
export function selectVerifier(env: NodeJS.ProcessEnv = process.env): Verifier {
	if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim() !== "") {
		// TODO(#15-followup): when an LlmVerifier ships, instantiate it here.
		// For now, fall through deterministically.
		return new SubstringVerifier();
	}
	return new SubstringVerifier();
}

// Recursively pull every string-typed leaf from a record.
function collectStrings(value: unknown): string[] {
	const out: string[] = [];
	walk(value, out);
	return out;
}

function walk(value: unknown, out: string[]): void {
	if (value == null) return;
	if (typeof value === "string") {
		out.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) walk(v, out);
		return;
	}
	if (typeof value === "object") {
		for (const v of Object.values(value as Record<string, unknown>)) walk(v, out);
	}
}

function truncate(s: string, max = 80): string {
	return s.length > max ? s.slice(0, max) + "…" : s;
}
