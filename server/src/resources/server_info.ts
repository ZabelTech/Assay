// §10.3 — server_info. Factual structured metadata only; no prose or scalar trust signals (§10.3.4).

export interface ServerInfoOpts {
	operatorUrl: string;
	operatorType: "hosted" | "self_hosted" | "experimental";
}

export function readServerInfoResource(opts: ServerInfoOpts) {
	const payload = {
		protocol_version: "cairn/0.1",
		extensions: [],
		implementation: {
			name: "Cairn Reference Server",
			version: "0.0.0",
			vendor: "ZabelTech",
			vendor_url: "https://assay.bot",
			source_url: "https://github.com/ZabelTech/Assay",
		},
		operator: {
			type: opts.operatorType,
			name: opts.operatorUrl,
			url: opts.operatorUrl,
		},
		conformance: {
			required_tools: ["query_career", "list_claims", "get_claim"],
			recommended_tools: [],
			attestation_levels_enforced: ["self_attested", "email_attested", "derived"],
		},
		behaviors: {
			default_compensation_visibility: "private",
			audit_logging: true,
			token_log_stripping: true,
		},
		v0_1_extensions_supported: [],
	};
	return {
		contents: [
			{
				uri: "cairn://server_info",
				mimeType: "application/json",
				text: JSON.stringify(payload),
			},
		],
	};
}
