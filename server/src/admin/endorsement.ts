// #7 endorsement state model + verification gate. Two-state model only: `pending` and
// `completed`. No `expired` or `declined` per #7.
//
// Solicitation requires completed subject verification (-32011 otherwise). Completion is
// unauthenticated — the emailed challenge token is the credential.
import type { Hono, Context } from "hono";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { Mailer } from "../adapters/mailer.js";
import { handleEndorsementStart, handleEndorsementComplete } from "../verification/endorser.js";
import { CairnError } from "../mcp/errors.js";
import { requireAdmin } from "./auth.js";

export interface AdminEndorsementDeps {
	adminTokens: AdminTokensRepo;
	subjects: SubjectRepo;
	claims: ClaimsRepo;
	mailer: Mailer;
	operatorUrl: string;
	defaultSubject: string;
}

export function mountAdminEndorsementRoutes(app: Hono, deps: AdminEndorsementDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	const requireVerifiedSubject = (c: Context): Response | undefined => {
		const current = deps.subjects.getCurrentSubject() ?? deps.defaultSubject;
		if (!deps.subjects.isVerified(current)) {
			const err = new CairnError(
				"precondition_failed_verification",
				"subject verification required before solicitation",
			);
			return c.json({ error: err.toRpcError() }, 412);
		}
		return undefined;
	};

	app.post("/admin/api/endorsement/solicit", admin, async (c) => {
		const gate = requireVerifiedSubject(c);
		if (gate) return gate;
		const body = (await c.req.json().catch(() => ({}))) as {
			endorser_email?: string;
			endorser_name?: string;
			value?: unknown;
		};
		const result = await handleEndorsementStart(
			{ ...deps, subject: deps.defaultSubject },
			body,
		);
		if (!result.ok) {
			const err = new CairnError("malformed_input", "endorser_email and value required");
			return c.json({ error: err.toRpcError() }, 400);
		}
		return c.json(result, 202);
	});

	app.get("/admin/api/endorsement", admin, (c) => {
		const rows = deps.subjects.listEndorsementSolicitations();
		return c.json({
			solicitations: rows.map((r) => ({
				solicitation_id: r.solicitation_id,
				endorser_email: r.endorser_email,
				endorser_name: r.endorser_name ?? undefined,
				state: r.state,
				solicited_at: r.solicited_at,
			})),
		});
	});

	app.post("/admin/api/endorsement/:solicitation_id/resolicit", admin, async (c) => {
		const id = c.req.param("solicitation_id");
		const sol = deps.subjects.findEndorsementSolicitation(id);
		if (!sol) {
			const err = new CairnError("claim_not_found", "solicitation not found");
			return c.json({ error: err.toRpcError() }, 404);
		}
		if (sol.state === "completed") {
			const err = new CairnError(
				"malformed_input",
				"cannot re-solicit a completed endorsement; delete the claim and solicit anew",
			);
			return c.json({ error: err.toRpcError() }, 400);
		}
		const currentSubject = deps.subjects.getCurrentSubject() ?? deps.defaultSubject;
		const link = `${deps.operatorUrl}/admin/api/endorsement/complete?challenge=${sol.challenge}`;
		await deps.mailer.send({
			to: sol.endorser_email,
			subject: `Confirm endorsement for ${currentSubject} (reminder)`,
			body: `Reminder: you have been asked to endorse ${currentSubject}.\n\nConfirm: ${link}\n`,
		});
		return c.json({ ok: true }, 202);
	});

	// Unauthenticated completion — the challenge in the URL is the credential. Preserved
	// from the original transport.ts wiring; same handler.
	app.get("/admin/api/endorsement/complete", (c) => {
		const challenge = c.req.query("challenge");
		const discloseLocal = c.req.query("disclose_local") === "1";
		const ok = handleEndorsementComplete(
			{ ...deps, subject: deps.defaultSubject },
			{ challenge, discloseLocal },
		);
		return c.json({ ok }, ok ? 200 : 400);
	});
}
