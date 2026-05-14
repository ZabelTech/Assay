// #7 admin routes — mounted at /admin/api/*, gated by the admin bearer middleware where
// appropriate. Completion endpoints (verify/complete, endorsement/complete) stay
// unauthenticated because the email-delivered challenge is the credential.
import type { Hono } from "hono";
import type { Database } from "better-sqlite3";
import type { AdminAuditRepo } from "../storage/admin_audit.repo.js";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { AuditRepo } from "../storage/audit.repo.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { ClaimDraftsRepo } from "../storage/claim_drafts.repo.js";
import type { HandlesRepo } from "../storage/handles.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { TokensRepo } from "../storage/tokens.repo.js";
import type { Mailer } from "../adapters/mailer.js";
import type { EvidenceStore } from "../adapters/evidence_store.js";
import type { OAuthProvider } from "../adapters/oauth.js";
import type { PendingWikiProposalsRepo } from "../storage/pending_wiki_proposals.repo.js";
import type { ConflictsRepo } from "../storage/conflicts.repo.js";
import type { WikiRepo } from "../wiki/repo.js";
import type { ImportPipeline } from "../pipeline/import_pipeline.js";
import { requireAdmin } from "./auth.js";
import { mountAdminAuditRoutes } from "./audit.js";
import { mountAdminClaimRoutes } from "./claims.js";
import { mountAdminEndorsementRoutes } from "./endorsement.js";
import { mountAdminEvidenceRoutes } from "./evidence.js";
import { mountAdminHandleRoutes } from "./handle.js";
import { mountAdminImportsRoutes } from "./imports.js";
import { mountAdminSubjectRoutes } from "./subject.js";
import { mountAdminTokenRoutes } from "./tokens.js";
import { mountAdminWikiProposalsRoutes } from "./wiki_proposals.js";
import { mountAdminConflictsRoutes } from "./conflicts.js";

export interface AdminRouteDeps {
	subject: string;
	operatorUrl: string;
	operatorType: "hosted" | "self_hosted" | "experimental";
	db: Database;
	adminTokens: AdminTokensRepo;
	adminAudit: AdminAuditRepo;
	subjects: SubjectRepo;
	claims: ClaimsRepo;
	tokens: TokensRepo;
	audit: AuditRepo;
	handles: HandlesRepo;
	drafts: ClaimDraftsRepo;
	mailer: Mailer;
	evidenceStore: EvidenceStore;
	pipeline: ImportPipeline;
	oauthProviders: Map<string, OAuthProvider>;
	wikiProposals: PendingWikiProposalsRepo;
	wikiRepo: WikiRepo;
	conflicts: ConflictsRepo;
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

	mountAdminClaimRoutes(app, {
		claims: deps.claims,
		subjects: deps.subjects,
		adminTokens: deps.adminTokens,
		adminAudit: deps.adminAudit,
		defaultSubject: deps.subject,
	});

	mountAdminEvidenceRoutes(app, {
		claims: deps.claims,
		adminTokens: deps.adminTokens,
		evidenceStore: deps.evidenceStore,
	});

	mountAdminEndorsementRoutes(app, {
		adminTokens: deps.adminTokens,
		subjects: deps.subjects,
		claims: deps.claims,
		mailer: deps.mailer,
		operatorUrl: deps.operatorUrl,
		defaultSubject: deps.subject,
	});

	mountAdminTokenRoutes(app, {
		adminTokens: deps.adminTokens,
		adminAudit: deps.adminAudit,
		subjects: deps.subjects,
		tokens: deps.tokens,
		defaultSubject: deps.subject,
	});

	mountAdminAuditRoutes(app, {
		adminTokens: deps.adminTokens,
		audit: deps.audit,
		adminAudit: deps.adminAudit,
	});

	mountAdminHandleRoutes(app, {
		adminTokens: deps.adminTokens,
		adminAudit: deps.adminAudit,
		handles: deps.handles,
		tokens: deps.tokens,
		operatorType: deps.operatorType,
	});

	mountAdminImportsRoutes(app, {
		adminTokens: deps.adminTokens,
		subjects: deps.subjects,
		drafts: deps.drafts,
		pipeline: deps.pipeline,
		oauthProviders: deps.oauthProviders,
		defaultSubject: deps.subject,
	});

	mountAdminWikiProposalsRoutes(app, {
		adminTokens: deps.adminTokens,
		adminAudit: deps.adminAudit,
		proposals: deps.wikiProposals,
		wikiRepo: deps.wikiRepo,
	});

	mountAdminConflictsRoutes(app, {
		adminTokens: deps.adminTokens,
		adminAudit: deps.adminAudit,
		conflicts: deps.conflicts,
		subjects: deps.subjects,
		claims: deps.claims,
		drafts: deps.drafts,
		defaultSubject: deps.subject,
	});
}
