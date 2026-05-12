// #7 admin token API — issue / list / revoke. Issuance gated on subject verification.
// List returns both active and revoked tokens (audit context). Default expiry 90 days,
// user-overridable. No upper bound enforced in v0 (#14 tracks whether to cap).
import type { Hono, Context } from "hono";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { TokensRepo } from "../storage/tokens.repo.js";
import { CairnError } from "../mcp/errors.js";
import { requireAdmin } from "./auth.js";

export interface AdminTokenDeps {
	adminTokens: AdminTokensRepo;
	subjects: SubjectRepo;
	tokens: TokensRepo;
	defaultSubject: string;
}

const NINETY_DAYS_MS = 90 * 86400_000;

export function mountAdminTokenRoutes(app: Hono, deps: AdminTokenDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	const requireVerifiedSubject = (c: Context): Response | undefined => {
		const current = deps.subjects.getCurrentSubject() ?? deps.defaultSubject;
		if (!deps.subjects.isVerified(current)) {
			const err = new CairnError(
				"precondition_failed_verification",
				"subject verification required before token issuance",
			);
			return c.json({ error: err.toRpcError() }, 412);
		}
		return undefined;
	};

	app.post("/admin/api/tokens", admin, async (c) => {
		const gate = requireVerifiedSubject(c);
		if (gate) return gate;
		const body = (await c.req.json().catch(() => ({}))) as {
			expires_at?: string;
			audience_hint?: string;
			purpose?: string;
		};
		const expires_at = body.expires_at ?? new Date(Date.now() + NINETY_DAYS_MS).toISOString();
		const { token, token_id } = deps.tokens.issue({
			expires_at,
			audience_hint: body.audience_hint,
			purpose: body.purpose,
		});
		return c.json(
			{
				token,
				token_id,
				expires_at,
				audience_hint: body.audience_hint,
				purpose: body.purpose,
			},
			201,
		);
	});

	app.get("/admin/api/tokens", admin, (c) => {
		return c.json({ tokens: deps.tokens.list() });
	});

	app.delete("/admin/api/tokens/:token_id", admin, (c) => {
		// Idempotent: revoking an unknown or already-revoked token still returns 204. The
		// candidate is signalling "this token must not work"; the operation either succeeds
		// or was already-succeeded.
		deps.tokens.revoke(c.req.param("token_id"));
		return c.body(null, 204);
	});
}
