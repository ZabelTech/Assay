// §10.2.1 — identity resource.
import { CairnError } from "../mcp/errors.js";
import type { BuildAppDeps } from "../mcp/transport.js";

export function readIdentityResource(deps: BuildAppDeps) {
	const claim = deps.claims.list({ type: "identity" })[0];
	if (!claim) {
		throw new CairnError("malformed_input", "no identity claim published");
	}
	return {
		contents: [
			{
				uri: "cairn://identity",
				mimeType: "application/json",
				text: JSON.stringify(claim),
			},
		],
	};
}
