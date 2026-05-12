// §10 — tools/list and resources/list MUST return the complete set regardless of auth state.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../helpers/server.js";

describe("§10 tools/list and resources/list discovery", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({});
	});
	afterEach(() => server.close());

	it("tools/list returns all three required tools to an anonymous client", async () => {
		const res = await server.request({ method: "tools/list" });
		const names = (res.body.result?.tools ?? []).map((t: any) => t.name).sort();
		expect(names).toEqual(["get_claim", "list_claims", "query_career"]);
	});

	it("tools/list returns the same list to an authenticated client", async () => {
		// WHY: §10 — "The presence of permissioned tools is not hidden information; their contents are."
		// Permissions are enforced at call time, not at discovery time.
		const { token } = server.issueToken();
		const anon = await server.request({ method: "tools/list" });
		const authed = await server.request({ method: "tools/list", token });
		expect(authed.body.result?.tools).toEqual(anon.body.result?.tools);
	});

	it("resources/list returns all three required resources to anonymous clients", async () => {
		const res = await server.request({ method: "resources/list" });
		const uris = (res.body.result?.resources ?? []).map((r: any) => r.name).sort();
		expect(uris).toEqual(["identity", "schema", "server_info"]);
	});

	it("resources/list returns the same list authenticated", async () => {
		const { token } = server.issueToken();
		const anon = await server.request({ method: "resources/list" });
		const authed = await server.request({ method: "resources/list", token });
		expect(authed.body.result?.resources).toEqual(anon.body.result?.resources);
	});
});
