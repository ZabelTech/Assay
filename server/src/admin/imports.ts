// #7 Phase 9 + #15 — admin import paths. Each handler still produces
// self_attested drafts for review-before-publish, but the body of work has
// moved into ImportPipeline.ingest() so the same normalize → corpus →
// structurer → persist path runs for every source. Publish now goes through
// ImportPipeline.publish() which resolves each draft's pinned corpus origin,
// runs the Verifier, and rewrites evidence to point at the raw artifact
// (#15's hard privacy boundary: corpus markdown is never reachable from the
// MCP endpoint).
//
// Acceptance bullets pinned (unchanged from #7):
// - "All four import paths produce `self_attested` draft claims that the
//    candidate edits before publish"
// - "LinkedIn and GitHub OAuth providers are mocked in the automated test;
//    real-provider OAuth is verified out-of-band"
import type { Context, Hono } from "hono";
import { randomBytes } from "node:crypto";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { ClaimDraftsRepo } from "../storage/claim_drafts.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { OAuthProvider } from "../adapters/oauth.js";
import { CairnError } from "../mcp/errors.js";
import { ImportPipeline, PipelineError } from "../pipeline/import_pipeline.js";
import type { Target } from "../pipeline/types.js";
import { requireAdmin } from "./auth.js";

export interface AdminImportsDeps {
	adminTokens: AdminTokensRepo;
	subjects: SubjectRepo;
	drafts: ClaimDraftsRepo;
	pipeline: ImportPipeline;
	oauthProviders: Map<string, OAuthProvider>;
	defaultSubject: string;
}

interface OAuthStateEntry {
	provider_id: string;
	created_at: number;
}

const OAUTH_STATE_TTL_MS = 10 * 60_000; // 10 minutes per the plan.

export function mountAdminImportsRoutes(app: Hono, deps: AdminImportsDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	const oauthStates = new Map<string, OAuthStateEntry>();
	const sweep = () => {
		const now = Date.now();
		for (const [k, v] of oauthStates) {
			if (now - v.created_at > OAUTH_STATE_TTL_MS) oauthStates.delete(k);
		}
	};

	const currentSubject = () => deps.subjects.getCurrentSubject() ?? deps.defaultSubject;

	// ---------------- Draft store ----------------

	app.get("/admin/api/drafts", admin, (c) => {
		return c.json({ drafts: deps.drafts.list() });
	});

	app.get("/admin/api/drafts/:id", admin, (c) => {
		const d = deps.drafts.get(c.req.param("id"));
		if (!d) return notFound(c);
		return c.json({ draft: d });
	});

	app.put("/admin/api/drafts/:id", admin, async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const updated = deps.drafts.update(c.req.param("id"), {
			value: body.value as Record<string, unknown> | undefined,
			visibility: body.visibility as never,
			type: body.type as string | undefined,
		});
		if (!updated) return notFound(c);
		return c.json({ draft: updated });
	});

	app.delete("/admin/api/drafts/:id", admin, (c) => {
		const ok = deps.drafts.delete(c.req.param("id"));
		if (!ok) return notFound(c);
		return c.body(null, 204);
	});

	app.post("/admin/api/drafts/publish", admin, async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { draft_ids?: string[] };
		const ids = Array.isArray(body.draft_ids) ? body.draft_ids : [];
		if (ids.length === 0) return malformed(c, "draft_ids required");
		try {
			const result = await deps.pipeline.publish({ draft_ids: ids, subject: currentSubject() });
			return c.json(result, 201);
		} catch (err) {
			if (err instanceof PipelineError) {
				return malformed(c, `${err.message}${err.detail ? ` (${err.detail})` : ""}`);
			}
			return malformed(c, err instanceof Error ? err.message : String(err));
		}
	});

	// ---------------- Text paste ----------------

	app.post("/admin/api/import/paste", admin, async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { text?: string; target?: Target };
		if (typeof body.text !== "string" || body.text.length === 0) {
			return malformed(c, "text required");
		}
		try {
			const result = await deps.pipeline.ingest({
				raw: body.text,
				source_type: "paste",
				subject: currentSubject(),
				target: body.target,
				rawMediaType: "text/plain",
			});
			return c.json({ drafts: result.drafts }, 201);
		} catch (err) {
			return malformed(c, err instanceof Error ? err.message : String(err));
		}
	});

	// ---------------- PDF upload ----------------

	app.post("/admin/api/import/pdf", admin, async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { data_base64?: string; target?: Target };
		if (typeof body.data_base64 !== "string") return malformed(c, "data_base64 required");
		const buffer = Buffer.from(body.data_base64, "base64");
		try {
			const result = await deps.pipeline.ingest({
				raw: buffer,
				source_type: "pdf",
				subject: currentSubject(),
				target: body.target,
				rawMediaType: "application/pdf",
			});
			return c.json({ drafts: result.drafts }, 201);
		} catch (err) {
			return malformed(c, err instanceof Error ? err.message : String(err));
		}
	});

	// ---------------- OAuth (LinkedIn / GitHub) ----------------

	app.post("/admin/api/import/oauth/:provider/start", admin, (c) => {
		sweep();
		const providerId = c.req.param("provider");
		const provider = deps.oauthProviders.get(providerId);
		if (!provider) return malformed(c, `unknown oauth provider "${providerId}"`);
		const state = randomBytes(16).toString("base64url");
		oauthStates.set(state, { provider_id: providerId, created_at: Date.now() });
		return c.json({ authorize_url: provider.getAuthorizationUrl(state), state });
	});

	app.get("/admin/api/import/oauth/:provider/callback", admin, async (c) => {
		sweep();
		const providerId = c.req.param("provider");
		const provider = deps.oauthProviders.get(providerId);
		if (!provider) return malformed(c, `unknown oauth provider "${providerId}"`);
		const code = c.req.query("code");
		const state = c.req.query("state");
		if (!code || !state) return malformed(c, "code and state required");
		const stateEntry = oauthStates.get(state);
		if (!stateEntry || stateEntry.provider_id !== providerId) {
			return malformed(c, "state mismatch or expired");
		}
		// Single-use state to prevent replay.
		oauthStates.delete(state);

		const { access_token } = await provider.exchangeCode(code);
		const profile = await provider.fetchProfile(access_token);
		try {
			const result = await deps.pipeline.ingest({
				raw: profile.raw,
				source_type: providerId,
				subject: currentSubject(),
				rawMediaType: "application/json",
			});
			return c.json({ drafts: result.drafts }, 201);
		} catch (err) {
			return malformed(c, err instanceof Error ? err.message : String(err));
		}
	});
}

function malformed(c: Context, message: string) {
	const err = new CairnError("malformed_input", message);
	return c.json({ error: err.toRpcError() }, 400);
}

function notFound(c: Context) {
	const err = new CairnError("claim_not_found", "draft not found");
	return c.json({ error: err.toRpcError() }, 404);
}
