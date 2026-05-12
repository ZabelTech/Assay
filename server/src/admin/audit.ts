// #7 admin audit-log read (§9.4). The candidate's audit log is never exposed through
// any MCP tool/resource; this admin endpoint is the only read surface.
import type { Hono } from "hono";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { AuditRepo } from "../storage/audit.repo.js";
import { requireAdmin } from "./auth.js";

export interface AdminAuditDeps {
	adminTokens: AdminTokensRepo;
	audit: AuditRepo;
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
}
