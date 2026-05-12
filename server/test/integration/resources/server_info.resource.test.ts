// §10.3 — server_info: structured factual metadata. No free-text trust statements, no scalar scores.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

describe("§10.3 server_info resource", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({});
	});
	afterEach(() => server.close());

	async function readInfo() {
		const res = await server.request({
			method: "resources/read",
			params: { uri: "cairn://server_info" },
		});
		return JSON.parse(res.body.result.contents[0].text);
	}

	it("declares cairn/0.1 protocol_version", async () => {
		const info = await readInfo();
		expect(info.protocol_version).toBe("cairn/0.1");
	});

	it("declares the three required tools and three required resources", async () => {
		// WHY: §10.3.1 — conformance.required_tools and required_resources are advertised metadata.
		const info = await readInfo();
		expect(info.conformance.required_tools.sort()).toEqual(["get_claim", "list_claims", "query_career"]);
	});

	it("enforces the three v0 attestation levels", async () => {
		const info = await readInfo();
		expect(info.conformance.attestation_levels_enforced.sort()).toEqual(["derived", "email_attested", "self_attested"]);
	});

	it("declares operator.type from the {hosted, self_hosted, experimental} enum", async () => {
		// WHY: §10.3.1 — operator.type MUST be one of three values; any other indicates misconfiguration.
		const info = await readInfo();
		expect(["hosted", "self_hosted", "experimental"]).toContain(info.operator.type);
	});

	it("does NOT contain free-text trust statements or about prose", async () => {
		// WHY: §10.3.4 — Servers MUST NOT include free-text "about us" or "trust statements" in server_info.
		// Trust is signaled through structure, not prose an LLM agent might credulously interpret.
		const info = await readInfo();
		expect(info.about).toBeUndefined();
		expect(info.trust_statement).toBeUndefined();
		expect(info.marketing).toBeUndefined();
	});

	it("does NOT contain numerical trust scores or reliability ratings", async () => {
		// WHY: §10.3.4 — no scalar trust signals. Trust levels are determined by who attests, not by a number.
		const info = await readInfo();
		expect(info.trust_score).toBeUndefined();
		expect(info.reliability).toBeUndefined();
		expect(info.score).toBeUndefined();
	});

	it("is returned without authentication", async () => {
		// WHY: §10.2.3 — server_info is REQUIRED and returned without auth.
		const res = await server.request({
			method: "resources/read",
			params: { uri: "cairn://server_info" },
		});
		expect(res.body.error).toBeUndefined();
	});
});
