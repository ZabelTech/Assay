// Admin-mutation audit log (#7 follow-up). Records the candidate's own
// control-plane actions so a compromised admin token cannot operate silently.
// Read surface lives at GET /admin/api/admin_audit (gated by the admin bearer);
// nothing here is ever surfaced through MCP tools/resources.
import type { Database } from "better-sqlite3";

export interface AdminAuditEntry {
	timestamp: string;
	action: string;
	target?: string;
	details?: Record<string, unknown>;
}

export interface AdminAuditRecord {
	action: string;
	target?: string;
	details?: Record<string, unknown>;
}

export class AdminAuditRepo {
	constructor(private db: Database) {}

	record(entry: AdminAuditRecord): void {
		this.db
			.prepare(
				`INSERT INTO admin_audit (timestamp, action, target, details) VALUES (?, ?, ?, ?)`,
			)
			.run(
				new Date().toISOString(),
				entry.action,
				entry.target ?? null,
				entry.details ? JSON.stringify(entry.details) : null,
			);
	}

	list(opts: { action?: string; since?: string } = {}): AdminAuditEntry[] {
		const clauses: string[] = [];
		const params: unknown[] = [];
		if (opts.action) {
			clauses.push("action = ?");
			params.push(opts.action);
		}
		if (opts.since) {
			clauses.push("timestamp >= ?");
			params.push(opts.since);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(
				`SELECT timestamp, action, target, details FROM admin_audit ${where} ORDER BY rowid ASC`,
			)
			.all(...params) as {
			timestamp: string;
			action: string;
			target: string | null;
			details: string | null;
		}[];
		return rows.map((r) => ({
			timestamp: r.timestamp,
			action: r.action,
			target: r.target ?? undefined,
			details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : undefined,
		}));
	}
}
