// §10.1.2 — list_claims. Type filter, since, limit, cursor. Derived claims absent.
import { z } from "zod";
import { CairnError } from "../mcp/errors.js";
import type { ToolContext } from "../mcp/transport.js";
import { filterByVisibility } from "../domain/visibility.js";
import { encodeCursor } from "../storage/claims.repo.js";

const ArgsZ = z
	.object({
		type: z.string().optional(),
		since: z.string().optional(),
		limit: z.number().int().positive().max(500).optional(),
		cursor: z.string().optional(),
	})
	.passthrough();

export async function handleListClaims(ctx: ToolContext, args: unknown) {
	const parsed = ArgsZ.safeParse(args ?? {});
	if (!parsed.success) {
		throw new CairnError("malformed_input", parsed.error.message);
	}
	const opts = parsed.data;
	const limit = opts.limit ?? 50;

	// Push visibility into the SQL query so pagination works against the visible set, not the raw set.
	// Otherwise pages can come back empty if a page's worth of underlying rows are all filtered out.
	const visibility = ctx.auth.authenticated ? ["public", "permissioned"] : ["public"];

	// Fetch one extra to determine whether more remain (so we can emit next_cursor).
	const fetched = ctx.deps.claims.list({
		type: opts.type,
		since: opts.since,
		cursor: opts.cursor,
		limit: limit + 1,
		visibility,
	});

	// Double-belt-and-braces filter: even with SQL constraint, never trust the storage to be right.
	const filtered = filterByVisibility(fetched, { authenticated: ctx.auth.authenticated });
	const window = filtered.slice(0, limit);
	const hasMore = filtered.length > limit;
	const next_cursor = hasMore && window.length > 0 ? encodeCursor(window[window.length - 1]!) : undefined;

	ctx.deps.audit.record({
		request_id: ctx.requestId,
		token_id: ctx.auth.token_id,
		audience_hint: ctx.auth.audience_hint,
		purpose: ctx.auth.purpose,
		timestamp: new Date().toISOString(),
		tool: "list_claims",
		claim_ids_returned: window.map((c) => c.claim_id),
	});

	return { claims: window, ...(next_cursor ? { next_cursor } : {}) };
}
