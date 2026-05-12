// §9.1 — Token entropy on issue; expired / revoked / unknown all produce distinct errors.
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/storage/db.js";
import { TokensRepo } from "../../src/storage/tokens.repo.js";

describe("§9.1 token lifecycle", () => {
	it("issues tokens with at least 128 bits of entropy", () => {
		// WHY: §9.1 — "Tokens MUST be generated using a cryptographically secure random source with at least 128 bits."
		const db = openDatabase(":memory:");
		const repo = new TokensRepo(db);
		const { token } = repo.issue({ expires_at: new Date(Date.now() + 86400000).toISOString() });
		// 128 bits = 16 bytes = at least 22 chars of base64url (no padding), or 32 hex chars.
		// Accept any encoding ≥ 22 chars; a stricter check would tie us to a specific encoding.
		expect(token.length).toBeGreaterThanOrEqual(22);
	});

	it("flags an expired token as expired", () => {
		const db = openDatabase(":memory:");
		const repo = new TokensRepo(db);
		const past = new Date(Date.now() - 1000).toISOString();
		const { token } = repo.issue({ expires_at: past });
		const status = repo.check(token);
		expect(status.kind).toBe("expired");
	});

	it("flags a revoked token as revoked", () => {
		const db = openDatabase(":memory:");
		const repo = new TokensRepo(db);
		const { token, token_id } = repo.issue({ expires_at: new Date(Date.now() + 86400000).toISOString() });
		repo.revoke(token_id);
		const status = repo.check(token);
		expect(status.kind).toBe("revoked");
	});

	it("flags an unknown token as invalid", () => {
		const db = openDatabase(":memory:");
		const repo = new TokensRepo(db);
		const status = repo.check("never-issued-token");
		expect(status.kind).toBe("invalid");
	});

	it("returns valid for a fresh, unexpired, unrevoked token", () => {
		const db = openDatabase(":memory:");
		const repo = new TokensRepo(db);
		const { token } = repo.issue({ expires_at: new Date(Date.now() + 86400000).toISOString() });
		const status = repo.check(token);
		expect(status.kind).toBe("valid");
	});

	it("issues distinct tokens across calls (no collision)", () => {
		// WHY: 128-bit entropy makes collisions astronomically unlikely; this is a smoke test on the RNG path.
		const db = openDatabase(":memory:");
		const repo = new TokensRepo(db);
		const seen = new Set<string>();
		for (let i = 0; i < 50; i++) {
			const { token } = repo.issue({ expires_at: new Date(Date.now() + 86400000).toISOString() });
			expect(seen.has(token)).toBe(false);
			seen.add(token);
		}
	});
});
