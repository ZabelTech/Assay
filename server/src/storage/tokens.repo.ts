// Opaque token storage. 128-bit entropy on issue; status check returns valid/expired/revoked/invalid.
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { TokenRecord, TokenStatus } from "../domain/types.js";

export class TokensRepo {
	constructor(private db: Database) {}

	issue(opts: {
		expires_at: string;
		audience_hint?: string;
		purpose?: string;
		revoked?: boolean;
	}): { token: string; token_id: string } {
		// 16 random bytes = 128 bits, encoded base64url for URL-safe transport.
		const token = randomBytes(16).toString("base64url");
		const token_id = randomBytes(8).toString("hex");
		const token_hash = hashToken(token);
		this.db
			.prepare(
				`INSERT INTO tokens (token_id, token_hash, expires_at, audience_hint, purpose, revoked, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				token_id,
				token_hash,
				opts.expires_at,
				opts.audience_hint ?? null,
				opts.purpose ?? null,
				opts.revoked ? 1 : 0,
				new Date().toISOString(),
			);
		return { token, token_id };
	}

	revoke(token_id: string): void {
		this.db.prepare(`UPDATE tokens SET revoked = 1 WHERE token_id = ?`).run(token_id);
	}

	check(token: string): TokenStatus {
		const row = this.db
			.prepare(
				`SELECT token_id, expires_at, audience_hint, purpose, revoked, created_at
				 FROM tokens WHERE token_hash = ?`,
			)
			.get(hashToken(token)) as
			| {
					token_id: string;
					expires_at: string;
					audience_hint: string | null;
					purpose: string | null;
					revoked: number;
					created_at: string;
			  }
			| undefined;
		if (!row) return { kind: "invalid" };
		const record: TokenRecord = {
			token_id: row.token_id,
			expires_at: row.expires_at,
			audience_hint: row.audience_hint ?? undefined,
			purpose: row.purpose ?? undefined,
			revoked: row.revoked === 1,
			created_at: row.created_at,
		};
		if (record.revoked) return { kind: "revoked", record };
		if (new Date(record.expires_at).getTime() <= Date.now()) return { kind: "expired", record };
		return { kind: "valid", record };
	}
}

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
