// #7 Phase 9 draft claims. Imports (LinkedIn / GitHub OAuth, PDF, paste) land here as
// `self_attested` drafts for review-before-publish. Publish atomically moves drafts to
// the `claims` table.
import type { Database } from "better-sqlite3";
import { randomBytes } from "node:crypto";
import type { Claim, Visibility } from "../domain/types.js";
import type { ClaimsRepo } from "./claims.repo.js";

export interface ClaimDraft {
	draft_id: string;
	source: string;
	type: string;
	value: Record<string, unknown>;
	visibility: Visibility;
	created_at: string;
	updated_at: string;
}

export class ClaimDraftsRepo {
	constructor(private db: Database) {}

	create(opts: { source: string; type: string; value: Record<string, unknown>; visibility?: Visibility }): ClaimDraft {
		const now = new Date().toISOString();
		const draft: ClaimDraft = {
			draft_id: `draft_${randomBytes(8).toString("hex")}`,
			source: opts.source,
			type: opts.type,
			value: opts.value,
			visibility: opts.visibility ?? (opts.type === "compensation" ? "private" : "permissioned"),
			created_at: now,
			updated_at: now,
		};
		const body = JSON.stringify(draft);
		this.db
			.prepare(
				`INSERT INTO claim_drafts (draft_id, source, type, visibility, created_at, updated_at, body)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(draft.draft_id, draft.source, draft.type, draft.visibility, draft.created_at, draft.updated_at, body);
		return draft;
	}

	list(): ClaimDraft[] {
		const rows = this.db.prepare(`SELECT body FROM claim_drafts ORDER BY created_at, draft_id`).all() as {
			body: string;
		}[];
		return rows.map((r) => JSON.parse(r.body) as ClaimDraft);
	}

	get(draft_id: string): ClaimDraft | undefined {
		const row = this.db.prepare(`SELECT body FROM claim_drafts WHERE draft_id = ?`).get(draft_id) as
			| { body: string }
			| undefined;
		return row ? (JSON.parse(row.body) as ClaimDraft) : undefined;
	}

	update(
		draft_id: string,
		patch: Partial<Pick<ClaimDraft, "value" | "visibility" | "type">>,
	): ClaimDraft | undefined {
		const existing = this.get(draft_id);
		if (!existing) return undefined;
		const updated: ClaimDraft = {
			...existing,
			...(patch.value ? { value: patch.value } : {}),
			...(patch.visibility ? { visibility: patch.visibility } : {}),
			...(patch.type ? { type: patch.type } : {}),
			updated_at: new Date().toISOString(),
		};
		const body = JSON.stringify(updated);
		this.db
			.prepare(
				`UPDATE claim_drafts SET type = ?, visibility = ?, updated_at = ?, body = ? WHERE draft_id = ?`,
			)
			.run(updated.type, updated.visibility, updated.updated_at, body, draft_id);
		return updated;
	}

	delete(draft_id: string): boolean {
		const info = this.db.prepare(`DELETE FROM claim_drafts WHERE draft_id = ?`).run(draft_id);
		return info.changes > 0;
	}

	// Publish moves drafts to the claims table atomically. Each draft becomes a self_attested
	// claim under the current subject. Returns the inserted claim IDs.
	publish(opts: { draft_ids: string[]; subject: string; claims: ClaimsRepo }): { claim_ids: string[] } {
		const inserted: string[] = [];
		const tx = this.db.transaction((ids: string[]) => {
			for (const draft_id of ids) {
				const draft = this.get(draft_id);
				if (!draft) throw new Error(`draft ${draft_id} not found`);
				const now = new Date().toISOString();
				const claim: Claim = {
					claim_id: `clm_${randomBytes(8).toString("hex")}`,
					subject: opts.subject,
					type: draft.type,
					value: draft.value,
					attestation: { level: "self_attested" },
					visibility: draft.visibility,
					created_at: now,
					updated_at: now,
				};
				opts.claims.insert(claim);
				this.db.prepare(`DELETE FROM claim_drafts WHERE draft_id = ?`).run(draft_id);
				inserted.push(claim.claim_id);
			}
		});
		tx(opts.draft_ids);
		return { claim_ids: inserted };
	}
}
