// #7 admin routes — mounted at /admin/api/*, gated by the admin bearer middleware where
// appropriate. Completion endpoints (verify/complete, endorsement/complete) stay
// unauthenticated because the email-delivered challenge is the credential.
import type { Hono } from "hono";
import type { Database } from "better-sqlite3";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { Mailer } from "../adapters/mailer.js";
import { requireAdmin } from "./auth.js";
import { mountAdminSubjectRoutes } from "./subject.js";

export interface AdminRouteDeps {
	subject: string;
	operatorUrl: string;
	db: Database;
	adminTokens: AdminTokensRepo;
	subjects: SubjectRepo;
	claims: ClaimsRepo;
	mailer: Mailer;
}

export function mountAdminRoutes(app: Hono, deps: AdminRouteDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	app.get("/admin/api/whoami", admin, (c) => {
		const current = deps.subjects.getCurrentSubject() ?? deps.subject;
		return c.json({
			subject: current,
			verified: deps.subjects.isVerified(current),
		});
	});

	mountAdminSubjectRoutes(app, {
		db: deps.db,
		subjects: deps.subjects,
		claims: deps.claims,
		adminTokens: deps.adminTokens,
		mailer: deps.mailer,
		operatorUrl: deps.operatorUrl,
		defaultSubject: deps.subject,
	});
}
