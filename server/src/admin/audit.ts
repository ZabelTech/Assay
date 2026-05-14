// #7 admin audit-log read (§9.4). The candidate's audit log is never exposed through
// any MCP tool/resource; this admin endpoint is the only read surface.
//
// Two logs are exposed here:
//   - GET /admin/api/audit        — the MCP request log (tool calls, claim_ids_returned).
//   - GET /admin/api/admin_audit  — the candidate's own control-plane actions
//                                   (token issue/revoke, claim CRUD, etc.).
import type { Hono } from "hono";
import type { AdminAuditRepo } from "../storage/admin_audit.repo.js";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { AuditRepo } from "../storage/audit.repo.js";
import { requireAdmin } from "./auth.js";

export interface AdminAuditDeps {
	adminTokens: AdminTokensRepo;
	audit: AuditRepo;
	adminAudit: AdminAuditRepo;
}

export function mountAdminAuditRoutes(app: Hono, deps: AdminAuditDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	app.get("/admin/api/audit", admin, (c) => {
		const entries = deps.audit.list({
			token_id: c.req.query("token_id"),
			since: c.req.query("since"),
			tool: c.req.query("tool"),
		});
		return c.json({ entries });
	});

	app.get("/admin/api/admin_audit", admin, (c) => {
		const entries = deps.adminAudit.list({
			action: c.req.query("action"),
			since: c.req.query("since"),
		});
		return c.json({ entries });
	});
}
