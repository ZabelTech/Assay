// #7 LLM-backed structurer for imports. Provider-abstract per the issue scope: ship the
// `Structurer` interface and a `MockStructurer` for tests. A concrete LLM impl (e.g. Claude)
// is a follow-up; clients BYO API key per issue #6's scope note.
import type { Visibility } from "../domain/types.js";

export interface DraftInput {
	type: string;
	value: Record<string, unknown>;
	visibility?: Visibility;
}

export interface Structurer {
	// Structure free-form raw input from an import path into a list of self_attested claim
	// drafts the candidate will edit before publish.
	structure(input: { raw: string; source: string }): Promise<DraftInput[]>;
}

export class MockStructurer implements Structurer {
	// Test-mode structurer: returns deterministic drafts from a registered map keyed by
	// the `source` field, or a single skill claim with the raw text as `summary` otherwise.
	private fixtures = new Map<string, DraftInput[]>();

	register(source: string, drafts: DraftInput[]): void {
		this.fixtures.set(source, drafts);
	}

	async structure(input: { raw: string; source: string }): Promise<DraftInput[]> {
		const fix = this.fixtures.get(input.source);
		if (fix) return fix;
		return [{ type: "narrative", value: { text: input.raw, scope: input.source } }];
	}
}
