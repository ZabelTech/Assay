// Subject verification state + per-challenge records. §4.1 + §7.2.1.
import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";

export class SubjectRepo {
	constructor(private db: Database) {}

	isVerified(email: string): boolean {
		const row = this.db.prepare(`SELECT verified FROM subjects WHERE email = ?`).get(email) as
			| { verified: number }
			| undefined;
		return row?.verified === 1;
	}

	markVerified(email: string, opts: { challenge_method: string }): void {
		this.db
			.prepare(
				`INSERT INTO subjects (email, verified, verified_at, challenge_method)
				 VALUES (?, 1, ?, ?)
				 ON CONFLICT(email) DO UPDATE SET verified = 1, verified_at = excluded.verified_at, challenge_method = excluded.challenge_method`,
			)
			.run(email, new Date().toISOString(), opts.challenge_method);
	}

	createChallenge(email: string, method: "click_through_link" | "code_return"): { challenge: string; code?: string } {
		const challenge = randomBytes(16).toString("base64url");
		const code = method === "code_return" ? randomBytes(4).toString("hex").toUpperCase() : undefined;
		this.db
			.prepare(
				`INSERT INTO subject_challenges (challenge, email, method, code, created_at, consumed)
				 VALUES (?, ?, ?, ?, ?, 0)`,
			)
			.run(challenge, email, method, code ?? null, new Date().toISOString());
		return { challenge, code };
	}

	consumeChallenge(opts: { challenge?: string; email?: string; code?: string }):
		| { email: string; method: string }
		| undefined {
		let row: { challenge: string; email: string; method: string; code: string | null; consumed: number } | undefined;
		if (opts.challenge) {
			row = this.db
				.prepare(`SELECT challenge, email, method, code, consumed FROM subject_challenges WHERE challenge = ?`)
				.get(opts.challenge) as typeof row;
		} else if (opts.email && opts.code) {
			row = this.db
				.prepare(
					`SELECT challenge, email, method, code, consumed FROM subject_challenges
					 WHERE email = ? AND code = ? AND consumed = 0
					 ORDER BY rowid DESC LIMIT 1`,
				)
				.get(opts.email, opts.code) as typeof row;
		}
		if (!row || row.consumed === 1) return undefined;
		this.db.prepare(`UPDATE subject_challenges SET consumed = 1 WHERE challenge = ?`).run(row.challenge);
		return { email: row.email, method: row.method };
	}

	createEndorsementChallenge(opts: {
		endorser_email: string;
		endorser_name?: string;
		value: unknown;
	}): { challenge: string } {
		const challenge = randomBytes(16).toString("base64url");
		this.db
			.prepare(
				`INSERT INTO endorsement_challenges (challenge, endorser_email, endorser_name, value_json, created_at, consumed)
				 VALUES (?, ?, ?, ?, ?, 0)`,
			)
			.run(challenge, opts.endorser_email, opts.endorser_name ?? null, JSON.stringify(opts.value), new Date().toISOString());
		return { challenge };
	}

	consumeEndorsementChallenge(challenge: string):
		| { endorser_email: string; endorser_name: string | null; value: unknown }
		| undefined {
		const row = this.db
			.prepare(
				`SELECT challenge, endorser_email, endorser_name, value_json, consumed
				 FROM endorsement_challenges WHERE challenge = ?`,
			)
			.get(challenge) as
			| { challenge: string; endorser_email: string; endorser_name: string | null; value_json: string; consumed: number }
			| undefined;
		if (!row || row.consumed === 1) return undefined;
		this.db.prepare(`UPDATE endorsement_challenges SET consumed = 1 WHERE challenge = ?`).run(challenge);
		return {
			endorser_email: row.endorser_email,
			endorser_name: row.endorser_name,
			value: JSON.parse(row.value_json),
		};
	}
}
