// §10.2.2 — schema resource: returns the schema version and JSON-LD context.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

describe("§10.2.2 schema resource", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({});
	});
	afterEach(() => server.close());

	it("returns schema_version of cairn/0.1", async () => {
		const res = await server.request({
			method: "resources/read",
			params: { uri: "cairn://schema" },
		});
		const parsed = JSON.parse(res.body.result.contents[0].text);
		expect(parsed.schema_version).toBe("cairn/0.1");
	});

	it("includes the Cairn v0 JSON-LD context", async () => {
		// WHY: §5 — career objects MUST include the Cairn v0 context URL; the resource exposes the document
		// so clients can fetch it without a separate dereference.
		const res = await server.request({
			method: "resources/read",
			params: { uri: "cairn://schema" },
		});
		const parsed = JSON.parse(res.body.result.contents[0].text);
		expect(parsed.context).toBeDefined();
		expect(JSON.stringify(parsed.context)).toContain("cairn");
	});

	it("is byte-stable across requests", async () => {
		// WHY: schema resource describes a versioned artifact; identical requests must yield identical bytes.
		const a = await server.request({ method: "resources/read", params: { uri: "cairn://schema" } });
		const b = await server.request({ method: "resources/read", params: { uri: "cairn://schema" } });
		expect(a.body.result.contents[0].text).toBe(b.body.result.contents[0].text);
	});
});
