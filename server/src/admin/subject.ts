// #7 admin subject lifecycle: start / resend / complete verification, GET current subject,
// and change-email with the §4 cascade (rewrite self_attested subjects, remove email_attested
// claims, remove pending endorsement solicitations).
import type { Hono } from "hono";
import type { Database } from "better-sqlite3";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { Mailer } from "../adapters/mailer.js";
import { handleSubjectVerifyStart, handleSubjectVerifyComplete } from "../verification/subject.js";
import { requireAdmin } from "./auth.js";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";

export interface AdminSubjectDeps {
	db: Database;
	subjects: SubjectRepo;
	claims: ClaimsRepo;
	adminTokens: AdminTokensRepo;
	mailer: Mailer;
	operatorUrl: string;
	// Default subject from config — used to seed the current_subject pointer the first time.
	defaultSubject: string;
}

interface PendingTarget {
	email: string;
	method: "click_through_link" | "code_return";
}

export function mountAdminSubjectRoutes(app: Hono, deps: AdminSubjectDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	// Per-app pending-challenge registry. Used by /resend (which needs to repeat the most
	// recent start) and tracked when /change-email kicks off a fresh challenge. Single-tenant
	// v0; one app == one candidate, so a flat map keyed by current subject is enough.
	const pendingByCurrent = new Map<string, PendingTarget>();

	// Ensure the current_subject pointer is seeded — required for the rest of the flow to work.
	// Idempotent.
	deps.subjects.seedSubject(deps.defaultSubject);

	app.get("/admin/api/subject", admin, (c) => {
		const email = deps.subjects.getCurrentSubject() ?? deps.defaultSubject;
		const verified = deps.subjects.isVerified(email);
		return c.json({ email, verified });
	});

	const currentKey = (): string => deps.subjects.getCurrentSubject() ?? deps.defaultSubject;

	const peekChallengeEmail = (body: { challenge?: string; email?: string; code?: string }): string | undefined => {
		if (body.challenge) {
			const row = deps.db
				.prepare(`SELECT email FROM subject_challenges WHERE challenge = ? AND consumed = 0`)
				.get(body.challenge) as { email: string } | undefined;
			return row?.email;
		}
		if (body.email && body.code) {
			const row = deps.db
				.prepare(
					`SELECT email FROM subject_challenges WHERE email = ? AND code = ? AND consumed = 0
					 ORDER BY rowid DESC LIMIT 1`,
				)
				.get(body.email, body.code) as { email: string } | undefined;
			return row?.email;
		}
		return undefined;
	};

	const completeAndMaybeCascade = (body: { challenge?: string; email?: string; code?: string }): boolean => {
		const verifyingEmail = peekChallengeEmail(body);
		if (!verifyingEmail) return false;
		const ok = handleSubjectVerifyComplete(deps, body);
		if (!ok) return false;

		const oldSubject = deps.subjects.getCurrentSubject();
		if (oldSubject && oldSubject !== verifyingEmail) {
			// #7 change-email cascade. Atomic across claim rewrites, claim deletions, pending
			// endorsement removal, and the current_subject pointer update.
			const cascade = deps.db.transaction(() => {
				deps.claims.rewriteSelfAttestedSubject(oldSubject, verifyingEmail);
				deps.claims.deleteByAttestationLevel("email_attested");
				deps.subjects.deleteAllPendingEndorsementChallenges();
				deps.subjects.setCurrentSubject(verifyingEmail);
			});
			cascade();
			pendingByCurrent.delete(oldSubject);
		} else if (!oldSubject) {
			deps.subjects.setCurrentSubject(verifyingEmail);
		}
		return true;
	};

	app.post("/admin/api/subject/verify/start", admin, async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			email?: string;
			method?: "click_through_link" | "code_return";
		};
		const email = body.email ?? deps.subjects.getCurrentSubject() ?? deps.defaultSubject;
		const method = body.method ?? "click_through_link";
		const result = await handleSubjectVerifyStart(deps, { email, method });
		pendingByCurrent.set(currentKey(), { email, method });
		return c.json(result, 202);
	});

	app.post("/admin/api/subject/verify/resend", admin, async (c) => {
		const pending = pendingByCurrent.get(currentKey());
		if (!pending) {
			return c.json({ error: "no pending verification" }, 400);
		}
		const result = await handleSubjectVerifyStart(deps, pending);
		return c.json(result, 202);
	});

	app.post("/admin/api/subject/change-email", admin, async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { new_email?: string };
		if (!body.new_email || typeof body.new_email !== "string") {
			return c.json({ error: "new_email required" }, 400);
		}
		// Triggers a fresh challenge against the new address. Per #7 the change takes effect
		// only on successful verification — completion handler detects the email-mismatch and
		// runs the cascade.
		const method = "click_through_link" as const;
		const result = await handleSubjectVerifyStart(deps, { email: body.new_email, method });
		pendingByCurrent.set(currentKey(), { email: body.new_email, method });
		return c.json(result, 202);
	});

	// Completion endpoints — intentionally unauthenticated: the challenge is the credential
	// (per §7.2.1's click-through-link pattern, the candidate clicks from email).
	app.get("/admin/api/subject/verify/complete", (c) => {
		const challenge = c.req.query("challenge");
		const ok = completeAndMaybeCascade({ challenge });
		return c.json({ ok }, ok ? 200 : 400);
	});
	app.post("/admin/api/subject/verify/complete", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string };
		const ok = completeAndMaybeCascade(body);
		return c.json({ ok }, ok ? 200 : 400);
	});
}
