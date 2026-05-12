// Claims storage. Enforces the §12 64KB per-claim soft cap at insert.
import type { Database } from "better-sqlite3";
import type { Claim } from "../domain/types.js";

const MAX_CLAIM_BYTES = 64 * 1024;

export class ClaimsRepo {
	constructor(private db: Database) {}

	insert(claim: Claim): void {
		const body = JSON.stringify(claim);
		if (body.length > MAX_CLAIM_BYTES) {
			throw new Error(`claim ${claim.claim_id} exceeds size limit (${body.length} > ${MAX_CLAIM_BYTES})`);
		}
		this.db
			.prepare(
				`INSERT OR REPLACE INTO claims (claim_id, subject, type, visibility, created_at, updated_at, body)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(claim.claim_id, claim.subject, claim.type, claim.visibility, claim.created_at, claim.updated_at, body);
	}

	get(claim_id: string): Claim | undefined {
		const row = this.db.prepare(`SELECT body FROM claims WHERE claim_id = ?`).get(claim_id) as
			| { body: string }
			| undefined;
		return row ? (JSON.parse(row.body) as Claim) : undefined;
	}

	list(opts: { type?: string; since?: string; limit?: number; cursor?: string; visibility?: string[] } = {}): Claim[] {
		const clauses: string[] = [];
		const params: unknown[] = [];
		if (opts.type) {
			clauses.push("type = ?");
			params.push(opts.type);
		}
		if (opts.since) {
			clauses.push("updated_at >= ?");
			params.push(opts.since);
		}
		if (opts.cursor) {
			const decoded = decodeCursor(opts.cursor);
			clauses.push("(created_at > ? OR (created_at = ? AND claim_id > ?))");
			params.push(decoded.created_at, decoded.created_at, decoded.claim_id);
		}
		if (opts.visibility && opts.visibility.length > 0) {
			const placeholders = opts.visibility.map(() => "?").join(",");
			clauses.push(`visibility IN (${placeholders})`);
			params.push(...opts.visibility);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const limitClause = opts.limit ? `LIMIT ${Number(opts.limit)}` : "";
		const rows = this.db
			.prepare(`SELECT body FROM claims ${where} ORDER BY created_at, claim_id ${limitClause}`)
			.all(...params) as { body: string }[];
		return rows.map((r) => JSON.parse(r.body) as Claim);
	}
}

export function encodeCursor(claim: Claim): string {
	return Buffer.from(`${claim.created_at}|${claim.claim_id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { created_at: string; claim_id: string } {
	const decoded = Buffer.from(cursor, "base64url").toString("utf8");
	const idx = decoded.indexOf("|");
	if (idx === -1) throw new Error("invalid cursor");
	return { created_at: decoded.slice(0, idx), claim_id: decoded.slice(idx + 1) };
}
