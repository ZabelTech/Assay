// Audit log. §9.4 — candidate-private; not exposed through any MCP tool or resource.
import type { Database } from "better-sqlite3";
import type { AuditEntry } from "../domain/types.js";

export class AuditRepo {
	constructor(private db: Database) {}

	record(entry: AuditEntry): void {
		this.db
			.prepare(
				`INSERT INTO audit_log (request_id, token_id, audience_hint, purpose, timestamp, tool, claim_ids_returned, claim_ids_consulted)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				entry.request_id,
				entry.token_id,
				entry.audience_hint ?? null,
				entry.purpose ?? null,
				entry.timestamp,
				entry.tool,
				JSON.stringify(entry.claim_ids_returned),
				entry.claim_ids_consulted ? JSON.stringify(entry.claim_ids_consulted) : null,
			);
	}

	list(): AuditEntry[] {
		const rows = this.db
			.prepare(
				`SELECT request_id, token_id, audience_hint, purpose, timestamp, tool, claim_ids_returned, claim_ids_consulted
				 FROM audit_log ORDER BY rowid ASC`,
			)
			.all() as {
			request_id: string;
			token_id: string | null;
			audience_hint: string | null;
			purpose: string | null;
			timestamp: string;
			tool: string;
			claim_ids_returned: string;
			claim_ids_consulted: string | null;
		}[];
		return rows.map((r) => ({
			request_id: r.request_id,
			token_id: r.token_id,
			audience_hint: r.audience_hint ?? undefined,
			purpose: r.purpose ?? undefined,
			timestamp: r.timestamp,
			tool: r.tool,
			claim_ids_returned: JSON.parse(r.claim_ids_returned) as string[],
			claim_ids_consulted: r.claim_ids_consulted ? (JSON.parse(r.claim_ids_consulted) as string[]) : undefined,
		}));
	}
}
