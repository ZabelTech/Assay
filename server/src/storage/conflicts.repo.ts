// #15 reconciliation queue. Conflict records produced at ingest time
// (cross-source from the structurer or re-import contradictions from the
// pipeline) land here. Resolved via merge / keep_both / edit / drop on the
// admin API.
import type { Database } from "better-sqlite3";
import { randomBytes } from "node:crypto";
import type { ConflictContender } from "../pipeline/types.js";

export type ConflictResolution = "merge" | "keep_both" | "edit" | "drop";

export interface Conflict {
	conflict_id: string;
	subject: string;
	rationale: string;
	contenders: ConflictContender[];
	created_at: string;
	resolved_at: string | null;
	resolution: ConflictResolution | null;
}

export class ConflictsRepo {
	constructor(private db: Database) {}

	create(opts: { subject: string; contenders: ConflictContender[]; rationale: string }): string {
		const conflict_id = `cnf_${randomBytes(8).toString("hex")}`;
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO conflicts (conflict_id, subject, rationale, contenders_json, created_at)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.run(conflict_id, opts.subject, opts.rationale, JSON.stringify(opts.contenders), now);
		return conflict_id;
	}

	get(conflict_id: string): Conflict | undefined {
		const row = this.db
			.prepare(
				`SELECT conflict_id, subject, rationale, contenders_json, created_at, resolved_at, resolution
				 FROM conflicts WHERE conflict_id = ?`,
			)
			.get(conflict_id) as
			| { conflict_id: string; subject: string; rationale: string; contenders_json: string; created_at: string; resolved_at: string | null; resolution: string | null }
			| undefined;
		if (!row) return undefined;
		return {
			conflict_id: row.conflict_id,
			subject: row.subject,
			rationale: row.rationale,
			contenders: JSON.parse(row.contenders_json) as ConflictContender[],
			created_at: row.created_at,
			resolved_at: row.resolved_at,
			resolution: (row.resolution as ConflictResolution | null) ?? null,
		};
	}

	listPending(subject: string): Conflict[] {
		const rows = this.db
			.prepare(
				`SELECT conflict_id, subject, rationale, contenders_json, created_at, resolved_at, resolution
				 FROM conflicts WHERE subject = ? AND resolved_at IS NULL ORDER BY created_at, conflict_id`,
			)
			.all(subject) as {
			conflict_id: string;
			subject: string;
			rationale: string;
			contenders_json: string;
			created_at: string;
			resolved_at: string | null;
			resolution: string | null;
		}[];
		return rows.map((r) => ({
			conflict_id: r.conflict_id,
			subject: r.subject,
			rationale: r.rationale,
			contenders: JSON.parse(r.contenders_json) as ConflictContender[],
			created_at: r.created_at,
			resolved_at: r.resolved_at,
			resolution: (r.resolution as ConflictResolution | null) ?? null,
		}));
	}

	resolve(conflict_id: string, resolution: ConflictResolution): boolean {
		const now = new Date().toISOString();
		const info = this.db
			.prepare(
				`UPDATE conflicts SET resolved_at = ?, resolution = ?
				 WHERE conflict_id = ? AND resolved_at IS NULL`,
			)
			.run(now, resolution, conflict_id);
		return info.changes > 0;
	}
}
