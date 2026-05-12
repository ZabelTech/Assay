// #7 admin auth — bearer-token credential storage for the candidate-facing admin API.
// SHA-256 hashed at rest, mirrors the MCP TokensRepo pattern but stays on a separate surface:
// admin tokens MUST NOT authenticate /mcp requests and MCP tokens MUST NOT authenticate /admin/api.
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";

export type AdminTokenStatus = "valid" | "invalid" | "revoked";

export class AdminTokensRepo {
	constructor(private db: Database) {}

	issue(): { token: string } {
		// 16 random bytes = 128 bits, base64url for header-safe transport.
		const token = randomBytes(16).toString("base64url");
		const token_hash = hashToken(token);
		this.db
			.prepare(`INSERT INTO admin_tokens (token_hash, created_at, revoked) VALUES (?, ?, 0)`)
			.run(token_hash, new Date().toISOString());
		return { token };
	}

	check(token: string): AdminTokenStatus {
		const row = this.db
			.prepare(`SELECT revoked FROM admin_tokens WHERE token_hash = ?`)
			.get(hashToken(token)) as { revoked: number } | undefined;
		if (!row) return "invalid";
		if (row.revoked === 1) return "revoked";
		return "valid";
	}

	revokeAll(): void {
		this.db.prepare(`UPDATE admin_tokens SET revoked = 1`).run();
	}
}

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
