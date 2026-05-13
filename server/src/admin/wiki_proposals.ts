// #17 admin endpoints for the pending-wiki-proposals queue.
//
// - GET    /admin/api/wiki/proposals          — list all pending proposals
// - GET    /admin/api/wiki/proposals/:id      — fetch one
// - POST   /admin/api/wiki/proposals/:id/promote — commit to the local wiki repo
//                                                  (linter runs as pre-commit hook;
//                                                   non-conforming → 400)
// - DELETE /admin/api/wiki/proposals/:id      — dismiss
//
// "Ignore" is the default — a proposal that's neither promoted nor dismissed stays
// pending indefinitely (#17 explicit), so no endpoint is needed for it.
import type { Context, Hono } from "hono";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { PendingWikiProposalsRepo } from "../storage/pending_wiki_proposals.repo.js";
import { WikiPromoteError, type WikiRepo } from "../wiki/repo.js";
import { CairnError } from "../mcp/errors.js";
import { requireAdmin } from "./auth.js";

export interface AdminWikiProposalsDeps {
	adminTokens: AdminTokensRepo;
	proposals: PendingWikiProposalsRepo;
	wikiRepo: WikiRepo;
}

export function mountAdminWikiProposalsRoutes(app: Hono, deps: AdminWikiProposalsDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	app.get("/admin/api/wiki/proposals", admin, (c) => {
		return c.json({ proposals: deps.proposals.list() });
	});

	app.get("/admin/api/wiki/proposals/:id", admin, (c) => {
		const p = deps.proposals.get(c.req.param("id"));
		if (!p) return notFound(c);
		return c.json({ proposal: p });
	});

	app.delete("/admin/api/wiki/proposals/:id", admin, (c) => {
		const ok = deps.proposals.delete(c.req.param("id"));
		if (!ok) return notFound(c);
		return c.body(null, 204);
	});

	app.post("/admin/api/wiki/proposals/:id/promote", admin, async (c) => {
		const id = c.req.param("id");
		const p = deps.proposals.get(id);
		if (!p) return notFound(c);

		try {
			const result = await deps.wikiRepo.promote({ kind: p.kind, slug: p.slug, markdown: p.markdown });
			// On successful commit, remove the proposal from the pending queue.
			deps.proposals.delete(id);
			return c.json({ commit_sha: result.commit_sha, path: result.relative_path }, 201);
		} catch (err) {
			if (err instanceof WikiPromoteError && err.stage === "lint") {
				const cerr = new CairnError("malformed_input", `wiki linter rejected the proposal: ${err.details ?? ""}`);
				return c.json({ error: cerr.toRpcError() }, 400);
			}
			// Unexpected git / filesystem failure. Surface the reason so the
			// candidate (or operator) can investigate; no Cairn error code applies
			// here since these are out-of-band system failures, not protocol
			// errors. Match the admin/imports.ts pattern of returning malformed_input
			// with the underlying detail string.
			const cerr = new CairnError(
				"malformed_input",
				`wiki promote failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			return c.json({ error: cerr.toRpcError() }, 500);
		}
	});
}

function notFound(c: Context) {
	const err = new CairnError("claim_not_found", "wiki proposal not found");
	return c.json({ error: err.toRpcError() }, 404);
}
