// §10.1.1 — query_career. Returns Claim[] (no answer/confidence), with optional derived synthesis.
import { z } from "zod";
import { CairnError } from "../mcp/errors.js";
import type { ToolContext } from "../mcp/transport.js";
import { filterByVisibility } from "../domain/visibility.js";
import type { Claim } from "../domain/types.js";

const ArgsZ = z.object({
	information_needed: z.string().min(1),
	client: z
		.object({
			audience_email: z.string().optional(),
			audience_hint: z.string().optional(),
			role_context: z.string().optional(),
		})
		.optional(),
	max_claims: z.number().int().positive().max(500).optional(),
});

export async function handleQueryCareer(ctx: ToolContext, args: unknown) {
	const parsed = ArgsZ.safeParse(args);
	if (!parsed.success) {
		throw new CairnError("malformed_input", parsed.error.issues[0]?.message ?? "invalid input");
	}
	const { information_needed, client, max_claims } = parsed.data;

	const all = ctx.deps.claims.list();
	const visible = filterByVisibility(all, { authenticated: ctx.auth.authenticated });

	// Selection + synthesis. The Synthesizer is responsible for the §7.3 anti-fabrication invariant:
	// derived_from MUST only reference IDs in `visible`.
	const result = ctx.deps.synthesizer.select({
		information_needed,
		visible_claims: visible,
		subject: ctx.deps.subject,
		derived_by: ctx.deps.operatorUrl,
		role_context: client?.role_context,
	});

	const selectedIds = new Set(result.selected_claim_ids);
	const storedSelected = visible.filter((c) => selectedIds.has(c.claim_id));

	const output: Claim[] = [...storedSelected, ...result.derived];
	const capped = max_claims ? output.slice(0, max_claims) : output;

	ctx.deps.audit.record({
		request_id: ctx.requestId,
		token_id: ctx.auth.token_id,
		audience_hint: ctx.auth.audience_hint,
		purpose: ctx.auth.purpose,
		timestamp: new Date().toISOString(),
		tool: "query_career",
		claim_ids_returned: capped.map((c) => c.claim_id),
		claim_ids_consulted: result.consulted_claim_ids,
	});

	return { claims: capped };
}
