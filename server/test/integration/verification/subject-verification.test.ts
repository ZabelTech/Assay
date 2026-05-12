// §4.1 — Subject email verification is a precondition for serving.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

describe("§4.1 subject email verification", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: false });
	});
	afterEach(() => server.close());

	it("refuses tool calls with -32007 when subject is not verified", async () => {
		// WHY: §4.1 — "Servers MUST NOT serve a career object whose subject has not completed verification."
		// -32007 is the onboarding-state error code (§10.4).
		const res = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
		});
		expect(res.body.error?.code).toBe(-32007);
	});

	it("refuses resource reads with -32007 when subject is not verified", async () => {
		const res = await server.request({
			method: "resources/read",
			params: { uri: "cairn://identity" },
		});
		expect(res.body.error?.code).toBe(-32007);
	});

	it("starts the verification flow via the internal API (click_through_link)", async () => {
		// WHY: §4.1 + §7.2.1 — the click_through challenge sends an email containing a unique single-use token.
		// We assert the CaptureMailer received the challenge and the link contains the token.
		const res = await server.rawFetch("/admin/api/subject/verify/start", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: server.subject, method: "click_through_link" }),
		});
		expect(res.status).toBe(202);
		expect(server.outbox().length).toBe(1);
		const mail = server.outbox()[0]!;
		expect(mail.to).toBe(server.subject);
		// Challenge tokens are base64url; assert that some long URL-safe token appears in the body.
		expect(mail.body).toMatch(/[A-Za-z0-9_-]{16,}/);
	});

	it("completes verification on a click-through and unblocks the MCP surface", async () => {
		await server.rawFetch("/admin/api/subject/verify/start", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: server.subject, method: "click_through_link" }),
		});
		const mail = server.outbox()[0]!;
		const token = mail.body.match(/challenge=([a-z0-9_-]+)/i)?.[1];
		expect(token).toBeDefined();

		const complete = await server.rawFetch(`/admin/api/subject/verify/complete?challenge=${token}`);
		expect(complete.status).toBe(200);

		const after = await server.request({
			method: "tools/call",
			params: { name: "list_claims", arguments: {} },
		});
		expect(after.body.error?.code).not.toBe(-32007);
	});

	it("supports the code_return challenge method", async () => {
		// WHY: §7.2.1 — code_return is the alternative method; servers MUST support both.
		const start = await server.rawFetch("/admin/api/subject/verify/start", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: server.subject, method: "code_return" }),
		});
		expect(start.status).toBe(202);
		const mail = server.outbox()[0]!;
		const code = mail.body.match(/code:\s*([A-Z0-9]{6,})/)?.[1];
		expect(code).toBeDefined();

		const complete = await server.rawFetch("/admin/api/subject/verify/complete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: server.subject, code }),
		});
		expect(complete.status).toBe(200);
	});

	it("rejects an incorrect code", async () => {
		await server.rawFetch("/admin/api/subject/verify/start", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: server.subject, method: "code_return" }),
		});
		const complete = await server.rawFetch("/admin/api/subject/verify/complete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: server.subject, code: "WRONGCODE" }),
		});
		expect(complete.status).toBe(400);
	});
});
