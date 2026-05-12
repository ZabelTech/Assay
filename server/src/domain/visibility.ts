// §9 — the only place visibility is enforced. Private claims are NEVER returned.
import type { Claim } from "./types.js";

export interface AuthState {
	authenticated: boolean;
}

export function filterByVisibility(claims: Claim[], auth: AuthState): Claim[] {
	return claims.filter((c) => {
		if (c.visibility === "private") return false; // hard rule.
		if (c.visibility === "permissioned") return auth.authenticated;
		return true; // public
	});
}

export function isVisible(claim: Claim, auth: AuthState): boolean {
	if (claim.visibility === "private") return false;
	if (claim.visibility === "permissioned") return auth.authenticated;
	return true;
}
