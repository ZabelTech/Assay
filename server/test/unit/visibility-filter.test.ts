// §9 — Visibility enforcement at the only place it lives in the codebase.
// Regression guard: private claims must NEVER appear in output. Fails loud if visibility code drifts.
import { describe, expect, it } from "vitest";
import { filterByVisibility } from "../../src/domain/visibility.js";
import {
	identityClaim,
	permissionedEmploymentClaim,
	privateCompensationClaim,
	publicProjectClaim,
} from "../fixtures/claims.js";

const all = [identityClaim, publicProjectClaim, permissionedEmploymentClaim, privateCompensationClaim];

describe("§9 visibility filter", () => {
	it("returns public claims to an unauthenticated requester", () => {
		const filtered = filterByVisibility(all, { authenticated: false });
		expect(filtered.map((c) => c.claim_id).sort()).toEqual([identityClaim.claim_id, publicProjectClaim.claim_id].sort());
	});

	it("returns public + permissioned to an authenticated requester", () => {
		const filtered = filterByVisibility(all, { authenticated: true });
		expect(filtered.map((c) => c.claim_id).sort()).toEqual(
			[identityClaim.claim_id, publicProjectClaim.claim_id, permissionedEmploymentClaim.claim_id].sort(),
		);
	});

	it("never returns private claims regardless of auth state", () => {
		// WHY: §9 — "A server MUST NOT return `private` claims under any circumstances."
		// This is the load-bearing guarantee. If this ever passes private through, candidates lose trust.
		const anon = filterByVisibility(all, { authenticated: false });
		const authed = filterByVisibility(all, { authenticated: true });
		expect(anon.some((c) => c.claim_id === privateCompensationClaim.claim_id)).toBe(false);
		expect(authed.some((c) => c.claim_id === privateCompensationClaim.claim_id)).toBe(false);
	});

	it("preserves claim contents bit-for-bit (no incidental mutation)", () => {
		// WHY: filter must be pure; downstream code relies on claim integrity.
		const filtered = filterByVisibility(all, { authenticated: true });
		const found = filtered.find((c) => c.claim_id === publicProjectClaim.claim_id);
		expect(found).toEqual(publicProjectClaim);
	});
});
