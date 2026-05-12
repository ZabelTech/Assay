// #7 Phase 9 — admin draft store + four import paths (paste / PDF / LinkedIn / GitHub OAuth).
// All four produce `self_attested` draft claims for review-before-publish. Publish moves
// drafts atomically into the `claims` table under the current subject.
//
// Acceptance bullets pinned:
// - "All four import paths produce `self_attested` draft claims that the candidate edits
//    before publish"
// - "LinkedIn and GitHub OAuth providers are mocked in the automated test; real-provider
//    OAuth is verified out-of-band"
import type { Context, Hono } from "hono";
import { randomBytes } from "node:crypto";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { ClaimDraftsRepo } from "../storage/claim_drafts.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { Structurer } from "../adapters/structurer.js";
import type { OAuthProvider } from "../adapters/oauth.js";
import type { PdfParser } from "../adapters/pdf_parser.js";
import { CairnError } from "../mcp/errors.js";
import { requireAdmin } from "./auth.js";

export interface AdminImportsDeps {
	adminTokens: AdminTokensRepo;
	subjects: SubjectRepo;
	claims: ClaimsRepo;
	drafts: ClaimDraftsRepo;
	structurer: Structurer;
	oauthProviders: Map<string, OAuthProvider>;
	pdfParser: PdfParser;
	defaultSubject: string;
}

interface OAuthStateEntry {
	provider_id: string;
	created_at: number;
}

const OAUTH_STATE_TTL_MS = 10 * 60_000; // 10 minutes per the plan.

export function mountAdminImportsRoutes(app: Hono, deps: AdminImportsDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	// Per-app OAuth state registry. Random `state` → provider id + timestamp. The map
	// cleans expired entries opportunistically on each access.
	const oauthStates = new Map<string, OAuthStateEntry>();
	const sweep = () => {
		const now = Date.now();
		for (const [k, v] of oauthStates) {
			if (now - v.created_at > OAUTH_STATE_TTL_MS) oauthStates.delete(k);
		}
	};

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
		const subject = deps.subjects.getCurrentSubject() ?? deps.defaultSubject;
		try {
			const result = deps.drafts.publish({ draft_ids: ids, subject, claims: deps.claims });
			return c.json(result, 201);
		} catch (err) {
			return malformed(c, err instanceof Error ? err.message : String(err));
		}
	});

	// ---------------- Text paste ----------------

	app.post("/admin/api/import/paste", admin, async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { text?: string; source?: string };
		if (typeof body.text !== "string" || body.text.length === 0) {
			return malformed(c, "text required");
		}
		const drafts = await deps.structurer.structure({
			raw: body.text,
			source: body.source ?? "paste",
		});
		const created = drafts.map((d) =>
			deps.drafts.create({ source: "paste", type: d.type, value: d.value, visibility: d.visibility }),
		);
		return c.json({ drafts: created }, 201);
	});

	// ---------------- PDF upload (base64 in JSON body for v0 simplicity) ----------------

	app.post("/admin/api/import/pdf", admin, async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { data_base64?: string };
		if (typeof body.data_base64 !== "string") return malformed(c, "data_base64 required");
		const buffer = Buffer.from(body.data_base64, "base64");
		const text = await deps.pdfParser.extractText(buffer);
		const drafts = await deps.structurer.structure({ raw: text, source: "pdf" });
		const created = drafts.map((d) =>
			deps.drafts.create({ source: "pdf", type: d.type, value: d.value, visibility: d.visibility }),
		);
		return c.json({ drafts: created }, 201);
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
		const drafts = await deps.structurer.structure({ raw: profile.raw, source: providerId });
		const created = drafts.map((d) =>
			deps.drafts.create({ source: providerId, type: d.type, value: d.value, visibility: d.visibility }),
		);
		return c.json({ drafts: created }, 201);
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
