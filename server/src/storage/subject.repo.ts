// Subject verification state + per-challenge records. §4.1 + §7.2.1.
import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";

export class SubjectRepo {
	constructor(private db: Database) {}

	seedSubject(email: string): void {
		// #7 admin bootstrap: the initial subject is set by an admin out-of-band.
		// Idempotent — does not touch verification state on existing rows.
		// Sets `current_subject` to this email IFF no current subject is set yet.
		this.db
			.prepare(
				`INSERT INTO subjects (email, verified, verified_at, challenge_method)
				 VALUES (?, 0, NULL, NULL)
				 ON CONFLICT(email) DO NOTHING`,
			)
			.run(email);
		this.db
			.prepare(`INSERT INTO current_subject (id, email) VALUES (1, ?) ON CONFLICT(id) DO NOTHING`)
			.run(email);
	}

	getCurrentSubject(): string | null {
		const row = this.db.prepare(`SELECT email FROM current_subject WHERE id = 1`).get() as
			| { email: string }
			| undefined;
		return row?.email ?? null;
	}

	setCurrentSubject(email: string): void {
		// #7 change-email: atomic pointer update. The caller is responsible for the rest of
		// the cascade (claim rewrites, email_attested removal, pending solicitation removal).
		this.db
			.prepare(
				`INSERT INTO current_subject (id, email) VALUES (1, ?)
				 ON CONFLICT(id) DO UPDATE SET email = excluded.email`,
			)
			.run(email);
	}

	countPendingEndorsementChallenges(): number {
		const row = this.db
			.prepare(`SELECT COUNT(*) AS n FROM endorsement_challenges WHERE consumed = 0`)
			.get() as { n: number };
		return row.n;
	}

	deleteAllPendingEndorsementChallenges(): void {
		// #7 change-email cascade: pending solicitations were initiated under the old subject
		// context and are no longer meaningful.
		this.db.prepare(`DELETE FROM endorsement_challenges WHERE consumed = 0`).run();
	}

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
		// Atomic compare-and-swap via UPDATE ... WHERE consumed = 0 RETURNING. Two
		// concurrent callers can both observe `consumed = 0` in a separate SELECT,
		// then both flip the flag and both believe they consumed the challenge —
		// the single-statement form has SQLite serialize the write.
		let row: { email: string; method: string } | undefined;
		if (opts.challenge) {
			row = this.db
				.prepare(
					`UPDATE subject_challenges SET consumed = 1
					 WHERE challenge = ? AND consumed = 0
					 RETURNING email, method`,
				)
				.get(opts.challenge) as typeof row;
		} else if (opts.email && opts.code) {
			// Pick the newest matching unconsumed challenge and flip it in one shot. SQLite
			// doesn't accept ORDER BY/LIMIT directly in UPDATE, so we scope by a subquery on
			// rowid. The unique rowid selection plus the consumed-0 guard keeps it atomic.
			row = this.db
				.prepare(
					`UPDATE subject_challenges SET consumed = 1
					 WHERE rowid = (
						SELECT rowid FROM subject_challenges
						WHERE email = ? AND code = ? AND consumed = 0
						ORDER BY rowid DESC LIMIT 1
					 )
					 RETURNING email, method`,
				)
				.get(opts.email, opts.code) as typeof row;
		}
		return row;
	}

	createEndorsementChallenge(opts: {
		endorser_email: string;
		endorser_name?: string;
		value: unknown;
		// #7 Phase 5: optional caller-provided solicitation_id. When omitted (legacy callers),
		// a fresh id is generated so list-by-id is always possible.
		solicitation_id?: string;
	}): { challenge: string; solicitation_id: string } {
		const challenge = randomBytes(16).toString("base64url");
		const solicitation_id = opts.solicitation_id ?? `sol_${randomBytes(8).toString("hex")}`;
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO endorsement_challenges (challenge, endorser_email, endorser_name, value_json, created_at, consumed, solicitation_id, solicited_at)
				 VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
			)
			.run(
				challenge,
				opts.endorser_email,
				opts.endorser_name ?? null,
				JSON.stringify(opts.value),
				now,
				solicitation_id,
				now,
			);
		return { challenge, solicitation_id };
	}

	listEndorsementSolicitations(): Array<{
		solicitation_id: string;
		challenge: string;
		endorser_email: string;
		endorser_name: string | null;
		state: "pending" | "completed";
		solicited_at: string;
	}> {
		const rows = this.db
			.prepare(
				`SELECT solicitation_id, challenge, endorser_email, endorser_name, consumed, solicited_at, created_at
				 FROM endorsement_challenges
				 WHERE solicitation_id IS NOT NULL
				 ORDER BY rowid`,
			)
			.all() as Array<{
			solicitation_id: string;
			challenge: string;
			endorser_email: string;
			endorser_name: string | null;
			consumed: number;
			solicited_at: string | null;
			created_at: string;
		}>;
		return rows.map((r) => ({
			solicitation_id: r.solicitation_id,
			challenge: r.challenge,
			endorser_email: r.endorser_email,
			endorser_name: r.endorser_name,
			state: r.consumed === 1 ? "completed" : "pending",
			solicited_at: r.solicited_at ?? r.created_at,
		}));
	}

	findEndorsementSolicitation(solicitation_id: string):
		| {
				solicitation_id: string;
				challenge: string;
				endorser_email: string;
				endorser_name: string | null;
				value: unknown;
				state: "pending" | "completed";
		  }
		| undefined {
		const row = this.db
			.prepare(
				`SELECT solicitation_id, challenge, endorser_email, endorser_name, value_json, consumed
				 FROM endorsement_challenges WHERE solicitation_id = ?`,
			)
			.get(solicitation_id) as
			| {
					solicitation_id: string;
					challenge: string;
					endorser_email: string;
					endorser_name: string | null;
					value_json: string;
					consumed: number;
			  }
			| undefined;
		if (!row) return undefined;
		return {
			solicitation_id: row.solicitation_id,
			challenge: row.challenge,
			endorser_email: row.endorser_email,
			endorser_name: row.endorser_name,
			value: JSON.parse(row.value_json),
			state: row.consumed === 1 ? "completed" : "pending",
		};
	}

	consumeEndorsementChallenge(challenge: string):
		| { endorser_email: string; endorser_name: string | null; value: unknown }
		| undefined {
		// Atomic compare-and-swap. See consumeChallenge above for the rationale.
		const row = this.db
			.prepare(
				`UPDATE endorsement_challenges SET consumed = 1
				 WHERE challenge = ? AND consumed = 0
				 RETURNING endorser_email, endorser_name, value_json`,
			)
			.get(challenge) as
			| { endorser_email: string; endorser_name: string | null; value_json: string }
			| undefined;
		if (!row) return undefined;
		return {
			endorser_email: row.endorser_email,
			endorser_name: row.endorser_name,
			value: JSON.parse(row.value_json),
		};
	}
}
