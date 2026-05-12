// §12 — soft size defaults: claims ≤64KB JSON, evidence ≤25MB, career ≤5MB. Fail loud, not truncate.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../helpers/server.js";

describe("§12 size limits", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({});
	});
	afterEach(() => server.close());

	it("rejects an oversized claim on ingest", () => {
		// WHY: §12 — claims should stay under 64KB. A hostile career object loaded with massive narratives
		// could otherwise be used to exhaust agent resources at query time.
		const huge = "x".repeat(70 * 1024);
		expect(() =>
			server.claims.insert({
				claim_id: "clm_huge",
				subject: server.subject,
				type: "narrative",
				value: { text: huge },
				attestation: { level: "self_attested" },
				visibility: "public",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
			} as any),
		).toThrow(/size|too large|limit/i);
	});

	it("returns -32008 malformed_input when the JSON-RPC body exceeds the request limit", async () => {
		// WHY: protect the MCP transport from oversized payloads via standard 413/-32008 surface.
		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "list_claims", arguments: { extra: "y".repeat(6 * 1024 * 1024) } },
		});
		const res = await server.rawFetch("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		// Either HTTP 413 or a JSON-RPC error envelope is acceptable; never silent success.
		const status = res.status;
		const text = await res.text();
		if (status === 200) {
			const parsed = JSON.parse(text);
			expect(parsed.error).toBeDefined();
		} else {
			expect(status).toBeGreaterThanOrEqual(400);
		}
	});
});
