// #7 admin routes — mounted at /admin/api/*, gated by the admin bearer middleware.
// Currently exposes `whoami` only; subsequent phases add subject/claims/evidence/tokens/etc.
//
// The existing public verification endpoints (subject verify, endorsement complete) remain
// in transport.ts for now because they are intentionally unauthenticated: the challenge in the
// emailed link is the credential. Phase 2 / Phase 5 will revisit which surfaces require admin
// auth and which stay challenge-authenticated.
import type { Hono } from "hono";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import { requireAdmin } from "./auth.js";

export interface AdminRouteDeps {
	subject: string;
	adminTokens: AdminTokensRepo;
	subjects: SubjectRepo;
}

export function mountAdminRoutes(app: Hono, deps: AdminRouteDeps): void {
	// requireAdmin is attached per-route (not as a /admin/api/* prefix) so that the existing
	// unauthenticated verification endpoints in transport.ts keep working. Later phases will
	// migrate verification under admin auth where appropriate.
	const admin = requireAdmin(deps.adminTokens);

	app.get("/admin/api/whoami", admin, (c) => {
		return c.json({
			subject: deps.subject,
			verified: deps.subjects.isVerified(deps.subject),
		});
	});
}
