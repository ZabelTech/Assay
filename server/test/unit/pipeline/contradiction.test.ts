// #15 deterministic re-import contradiction detector. Pins:
//
// - "Re-import contradiction: re-importing a source whose new corpus
//    version contradicts an existing published claim emits a ConflictRecord
//    with one kind:'draft' and one kind:'published' contender into the
//    reconciliation queue."
//
// The detector itself is deterministic (no LLM); these tests build claims
// directly (not via the pipeline) so the detector is exercised in isolation.
import { describe, expect, it } from "vitest";
import { detectContradictions } from "../../../src/pipeline/contradiction.js";
import type { Claim } from "../../../src/domain/types.js";
import type { DraftInput } from "../../../src/pipeline/types.js";

class StubClaimsRepo {
	constructor(private claims: Claim[]) {}
	list(): Claim[] {
		return this.claims;
	}
}

const mkClaim = (id: string, value: Record<string, unknown>): Claim => ({
	claim_id: id,
	subject: "alice@example.com",
	type: "employment",
	value,
	attestation: { level: "self_attested" },
	visibility: "permissioned",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
});

const mkDraft = (value: Record<string, unknown>): DraftInput => ({
	type: "employment",
	value,
	origin: [{ path: "linkedin.md", version: 1 }],
});

describe("#15 detectContradictions", () => {
	// WHY: the load-bearing case. New ingest says "Acme, 2020-2022";
	// existing published claim says "AcmeRival, 2020-2022". Same time
	// window, different employer. The detector must surface this so the
	// candidate reconciles — silent override would erase history.
	it("emits a conflict when employment in the same window has a different employer", () => {
		const repo = new StubClaimsRepo([
			mkClaim("clm_old", {
				employer: "AcmeRival",
				title: "Engineer",
				start_date: "2020-01-01",
				end_date: "2022-01-01",
				status: "ended",
			}),
		]);
		const drafts = [
			mkDraft({
				employer: "Acme",
				title: "Engineer",
				start_date: "2020-06-01",
				end_date: "2021-12-01",
				status: "ended",
			}),
		];
		const conflicts = detectContradictions({
			subject: "alice@example.com",
			drafts,
			claims: repo as unknown as Parameters<typeof detectContradictions>[0]["claims"],
		});
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]!.contenders).toHaveLength(2);
		const kinds = conflicts[0]!.contenders.map((c) => c.kind).sort();
		expect(kinds).toEqual(["draft", "published"]);
	});

	// WHY: non-overlapping time windows are not a contradiction — they
	// represent legitimate distinct employment periods at the same place.
	// Pin the detector doesn't falsely flag.
	it("does not flag claims whose time windows don't overlap", () => {
		const repo = new StubClaimsRepo([
			mkClaim("clm_old", {
				employer: "Acme",
				title: "Engineer",
				start_date: "2018-01-01",
				end_date: "2019-01-01",
				status: "ended",
			}),
		]);
		const drafts = [
			mkDraft({
				employer: "AcmeRival",
				title: "Engineer",
				start_date: "2020-01-01",
				end_date: "2022-01-01",
				status: "ended",
			}),
		];
		const conflicts = detectContradictions({
			subject: "alice@example.com",
			drafts,
			claims: repo as unknown as Parameters<typeof detectContradictions>[0]["claims"],
		});
		expect(conflicts).toEqual([]);
	});

	// WHY: overlapping windows with identical employer + title are NOT a
	// contradiction (it's just a re-extracted version of the same fact).
	// The detector must compare value fields and only flag genuine
	// disagreements.
	it("does not flag claims that overlap but agree on employer + title", () => {
		const repo = new StubClaimsRepo([
			mkClaim("clm_old", {
				employer: "Acme",
				title: "Engineer",
				start_date: "2020-01-01",
				end_date: "2022-01-01",
				status: "ended",
			}),
		]);
		const drafts = [
			mkDraft({
				employer: "Acme",
				title: "Engineer",
				start_date: "2020-06-01",
				end_date: "2021-12-01",
				status: "ended",
			}),
		];
		const conflicts = detectContradictions({
			subject: "alice@example.com",
			drafts,
			claims: repo as unknown as Parameters<typeof detectContradictions>[0]["claims"],
		});
		expect(conflicts).toEqual([]);
	});

	// WHY: types without start/end timestamps (skill, narrative,
	// preference) shouldn't be considered by the time-window detector. Pin
	// they pass through — they're either same-run cross-source (handled by
	// the structurer's own conflict emission) or genuine duplicates the
	// candidate can dedupe at review time.
	it("does not consider types without time bounds", () => {
		const repo = new StubClaimsRepo([
			{ ...mkClaim("clm_old", { name: "TypeScript" }), type: "skill" },
		]);
		const drafts = [{ ...mkDraft({ name: "Rust" }), type: "skill" }];
		const conflicts = detectContradictions({
			subject: "alice@example.com",
			drafts,
			claims: repo as unknown as Parameters<typeof detectContradictions>[0]["claims"],
		});
		expect(conflicts).toEqual([]);
	});
});
