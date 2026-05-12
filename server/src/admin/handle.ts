// #7 handle / subdomain (hosted deployments only). Changing the handle automatically
// revokes all outstanding tokens — URLs embed the old handle and would otherwise break
// in recipients' hands.
import type { Hono, Context } from "hono";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { HandlesRepo } from "../storage/handles.repo.js";
import type { TokensRepo } from "../storage/tokens.repo.js";
import { parseDnsLabel } from "../domain/validators.js";
import { CairnError } from "../mcp/errors.js";
import { requireAdmin } from "./auth.js";

export interface AdminHandleDeps {
	adminTokens: AdminTokensRepo;
	handles: HandlesRepo;
	tokens: TokensRepo;
	operatorType: "hosted" | "self_hosted" | "experimental";
}

export function mountAdminHandleRoutes(app: Hono, deps: AdminHandleDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	const requireHosted = (c: Context): Response | undefined => {
		if (deps.operatorType !== "hosted") {
			const err = new CairnError(
				"malformed_input",
				"handle/subdomain management is hosted-only; self-hosted operators choose the host out of band",
			);
			return c.json({ error: err.toRpcError() }, 404);
		}
		return undefined;
	};

	app.get("/admin/api/handle", admin, (c) => {
		const gate = requireHosted(c);
		if (gate) return gate;
		const row = deps.handles.get();
		if (!row) return c.body(null, 404);
		return c.json(row);
	});

	app.post("/admin/api/handle", admin, async (c) => {
		const gate = requireHosted(c);
		if (gate) return gate;
		const body = (await c.req.json().catch(() => ({}))) as { handle?: unknown };
		let handle: string;
		try {
			handle = parseDnsLabel(body.handle);
		} catch (err) {
			const wrapped = new CairnError("malformed_input", err instanceof Error ? err.message : String(err));
			return c.json({ error: wrapped.toRpcError() }, 400);
		}
		// #7: handle change auto-revokes all outstanding tokens.
		const revoked = deps.tokens.revokeAll();
		deps.handles.set(handle);
		return c.json({ handle, revoked_tokens: revoked });
	});
}
