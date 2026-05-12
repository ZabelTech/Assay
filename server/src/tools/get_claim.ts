// §10.1.3 — get_claim. Distinct error codes for not_found vs not_visible.
import { z } from "zod";
import { CairnError } from "../mcp/errors.js";
import type { ToolContext } from "../mcp/transport.js";
import { isVisible } from "../domain/visibility.js";

const ArgsZ = z.object({ claim_id: z.string().min(1) });

export async function handleGetClaim(ctx: ToolContext, args: unknown) {
	const parsed = ArgsZ.safeParse(args);
	if (!parsed.success) {
		throw new CairnError("malformed_input", "get_claim requires { claim_id }");
	}
	const { claim_id } = parsed.data;

	const claim = ctx.deps.claims.get(claim_id);
	if (!claim) {
		throw new CairnError("claim_not_found", `claim ${claim_id} does not exist`);
	}
	if (!isVisible(claim, { authenticated: ctx.auth.authenticated })) {
		throw new CairnError("claim_not_visible", `claim ${claim_id} is not visible to this requester`);
	}

	ctx.deps.audit.record({
		request_id: ctx.requestId,
		token_id: ctx.auth.token_id,
		audience_hint: ctx.auth.audience_hint,
		purpose: ctx.auth.purpose,
		timestamp: new Date().toISOString(),
		tool: "get_claim",
		claim_ids_returned: [claim.claim_id],
	});

	return { claim };
}
