// #7 admin auth — `Authorization: Bearer <admin-token>` middleware for /admin/api/*.
// Strictly separate from MCP token auth: admin tokens MUST NOT authenticate /mcp requests, and
// MCP tokens (`?t=`, `/t/`, or `Authorization: Bearer` for an MCP token) MUST NOT authenticate here.
import type { Context, MiddlewareHandler } from "hono";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import { CairnError } from "../mcp/errors.js";

export function requireAdmin(adminTokens: AdminTokensRepo): MiddlewareHandler {
	return async (c, next) => {
		const header = c.req.header("authorization") ?? "";
		const match = /^Bearer\s+(.+)$/i.exec(header);
		if (!match) return unauthorized(c, "missing admin bearer");
		const token = match[1]!.trim();
		const status = adminTokens.check(token);
		if (status !== "valid") return unauthorized(c, "admin token not accepted");
		await next();
	};
}

function unauthorized(c: Context, message: string) {
	const err = new CairnError("unauthorized_admin", message);
	return c.json({ error: err.toRpcError() }, 401);
}
