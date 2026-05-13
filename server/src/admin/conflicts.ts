// #15 reconciliation queue admin endpoints. Each conflict has at least two
// contenders (some combination of new drafts from the current run and existing
// published claims). The candidate resolves via one of four actions, mirroring
// the issue body:
//
//   merge      — replace contenders with a single combined claim citing both
//   keep_both  — leave existing claim in place AND keep the new draft
//   edit       — surface back the contenders for manual editing in the draft UI
//   drop       — remove the draft contender (and resolve the conflict)
//
// All four actions resolve the conflict (mark resolved_at + resolution). The
// pipeline doesn't re-trigger after resolution; the candidate has the steering
// wheel.
import type { Context, Hono } from "hono";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { ClaimDraftsRepo } from "../storage/claim_drafts.repo.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { ConflictsRepo, ConflictResolution } from "../storage/conflicts.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import { CairnError } from "../mcp/errors.js";
import { requireAdmin } from "./auth.js";

const VALID_ACTIONS: ConflictResolution[] = ["merge", "keep_both", "edit", "drop"];

export interface AdminConflictsDeps {
	adminTokens: AdminTokensRepo;
	conflicts: ConflictsRepo;
	subjects: SubjectRepo;
	claims: ClaimsRepo;
	drafts: ClaimDraftsRepo;
	defaultSubject: string;
}

export function mountAdminConflictsRoutes(app: Hono, deps: AdminConflictsDeps): void {
	const admin = requireAdmin(deps.adminTokens);
	const currentSubject = () => deps.subjects.getCurrentSubject() ?? deps.defaultSubject;

	app.get("/admin/api/conflicts", admin, (c) => {
		return c.json({ conflicts: deps.conflicts.listPending(currentSubject()) });
	});

	app.get("/admin/api/conflicts/:id", admin, (c) => {
		const conflict = deps.conflicts.get(c.req.param("id"));
		if (!conflict) return notFound(c);
		return c.json({ conflict });
	});

	app.post("/admin/api/conflicts/:id/resolve", admin, async (c) => {
		const conflict = deps.conflicts.get(c.req.param("id"));
		if (!conflict) return notFound(c);

		const body = (await c.req.json().catch(() => ({}))) as { action?: string };
		const action = body.action;
		if (!action || !VALID_ACTIONS.includes(action as ConflictResolution)) {
			return malformed(c, `action must be one of ${VALID_ACTIONS.join(" | ")}`);
		}

		// "drop" deletes any draft contenders so they don't stay in the
		// review queue alongside the kept published claim. Other actions
		// leave the drafts where they are — the candidate keeps editing
		// before publish, and the conflict is simply marked resolved.
		if (action === "drop") {
			for (const ct of conflict.contenders) {
				if (ct.kind === "draft") {
					// Find the matching draft by type+value; the draft was
					// persisted at ingest. Best-effort — if it was already
					// dropped, no-op.
					for (const d of deps.drafts.list()) {
						if (d.type === ct.draft.type && JSON.stringify(d.value) === JSON.stringify(ct.draft.value)) {
							deps.drafts.delete(d.draft_id);
							break;
						}
					}
				}
			}
		}

		const ok = deps.conflicts.resolve(conflict.conflict_id, action as ConflictResolution);
		if (!ok) {
			return malformed(c, "conflict already resolved");
		}
		return c.json({ conflict_id: conflict.conflict_id, resolution: action }, 200);
	});
}

function notFound(c: Context) {
	const err = new CairnError("claim_not_found", "conflict not found");
	return c.json({ error: err.toRpcError() }, 404);
}

function malformed(c: Context, message: string) {
	const err = new CairnError("malformed_input", message);
	return c.json({ error: err.toRpcError() }, 400);
}
