// #7 admin auth — bearer-token credential for the candidate-facing admin API.
// SHA-256-hashed at rest, 128-bit entropy on issue, revocable, separate surface from MCP tokens.
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { AdminTokensRepo } from "../../../src/storage/admin_tokens.repo.js";

describe("#7 admin token repo", () => {
	it("issues tokens with at least 128 bits of entropy", () => {
		// WHY: §9.1's 128-bit minimum is sensible for the admin surface too — same blast radius if leaked.
		const db = openDatabase(":memory:");
		const repo = new AdminTokensRepo(db);
		const { token } = repo.issue();
		expect(token.length).toBeGreaterThanOrEqual(22);
	});

	it("stores the SHA-256 hash, not the token itself", () => {
		// WHY: a DB leak should not equal a credential leak; mirror the MCP-token hashing pattern in tokens.repo.ts.
		const db = openDatabase(":memory:");
		const repo = new AdminTokensRepo(db);
		const { token } = repo.issue();
		const rows = db.prepare(`SELECT token_hash FROM admin_tokens`).all() as { token_hash: string }[];
		expect(rows.length).toBe(1);
		expect(rows[0]!.token_hash).not.toBe(token);
		expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("returns valid for an issued token", () => {
		const db = openDatabase(":memory:");
		const repo = new AdminTokensRepo(db);
		const { token } = repo.issue();
		expect(repo.check(token)).toBe("valid");
	});

	it("returns invalid for an unknown token", () => {
		const db = openDatabase(":memory:");
		const repo = new AdminTokensRepo(db);
		expect(repo.check("never-issued")).toBe("invalid");
	});

	it("returns revoked for a revoked token", () => {
		const db = openDatabase(":memory:");
		const repo = new AdminTokensRepo(db);
		const { token } = repo.issue();
		repo.revokeAll();
		expect(repo.check(token)).toBe("revoked");
	});

	it("rotation: issue new, revokeAll, then issue again — old revoked, new valid", () => {
		// WHY: v0 supports a single active admin token. Rotation is "revokeAll + issue".
		const db = openDatabase(":memory:");
		const repo = new AdminTokensRepo(db);
		const { token: old } = repo.issue();
		repo.revokeAll();
		const { token: fresh } = repo.issue();
		expect(repo.check(old)).toBe("revoked");
		expect(repo.check(fresh)).toBe("valid");
	});

	it("issues distinct tokens across calls", () => {
		const db = openDatabase(":memory:");
		const repo = new AdminTokensRepo(db);
		const seen = new Set<string>();
		for (let i = 0; i < 20; i++) {
			const { token } = repo.issue();
			expect(seen.has(token)).toBe(false);
			seen.add(token);
		}
	});
});
