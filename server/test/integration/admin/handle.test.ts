// #7 handle / subdomain (hosted only) + auto-revoke tokens on handle change.
//
// Acceptance bullet pinned: "Changing the handle revokes all outstanding tokens".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

describe("#7 admin handle (hosted)", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: true, operatorType: "hosted" });
	});
	afterEach(() => server.close());

	it("GET returns 404 when no handle is set", async () => {
		const res = await server.adminFetch("/admin/api/handle");
		expect(res.status).toBe(404);
	});

	it("accepts a valid DNS-label handle and stores it", async () => {
		const res = await server.adminFetch("/admin/api/handle", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle: "alice" }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { handle: string; revoked_tokens: number };
		expect(body.handle).toBe("alice");
	});

	it("lower-cases mixed-case handles before storing", async () => {
		const res = await server.adminFetch("/admin/api/handle", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle: "Alice-2" }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { handle: string };
		expect(body.handle).toBe("alice-2");
	});

	const invalid = [
		"",
		"-alice",
		"alice-",
		"alice!",
		"alice space",
		"a".repeat(64),
	];
	for (const h of invalid) {
		it(`rejects invalid handle ${JSON.stringify(h)}`, async () => {
			const res = await server.adminFetch("/admin/api/handle", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ handle: h }),
			});
			expect(res.status).toBe(400);
		});
	}

	it("changing handle revokes all outstanding tokens", async () => {
		// WHY: #7 — URLs embed the old handle and would otherwise break in recipients'
		// hands. Force re-issue.
		await server.adminFetch("/admin/api/handle", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle: "alice" }),
		});
		// Issue a couple of tokens.
		await server.adminFetch("/admin/api/tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		await server.adminFetch("/admin/api/tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});

		const change = await server.adminFetch("/admin/api/handle", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle: "alicia" }),
		});
		expect(change.status).toBe(200);
		const body = (await change.json()) as { revoked_tokens: number };
		expect(body.revoked_tokens).toBe(2);

		const list = await server.adminFetch("/admin/api/tokens");
		const tokens = ((await list.json()) as { tokens: { revoked: boolean }[] }).tokens;
		expect(tokens.length).toBe(2);
		expect(tokens.every((t) => t.revoked)).toBe(true);
	});

	it("rejects unauthenticated calls", async () => {
		const get = await server.adminFetch("/admin/api/handle", { noAuth: true });
		expect(get.status).toBe(401);
		const post = await server.adminFetch("/admin/api/handle", {
			method: "POST",
			noAuth: true,
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle: "alice" }),
		});
		expect(post.status).toBe(401);
	});
});

describe("#7 admin handle (self_hosted — endpoints not applicable)", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: true, operatorType: "self_hosted" });
	});
	afterEach(() => server.close());

	it("returns 404 on self-hosted deployments", async () => {
		const get = await server.adminFetch("/admin/api/handle");
		expect(get.status).toBe(404);
		const post = await server.adminFetch("/admin/api/handle", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ handle: "alice" }),
		});
		expect(post.status).toBe(404);
	});
});
