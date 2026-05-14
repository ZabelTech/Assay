// Admin-mutation audit log. The MCP audit log only records tool calls; this
// log records the candidate's own control-plane actions so a compromised admin
// token cannot operate silently.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

describe("admin-mutation audit log", () => {
	let server: TestServer;

	beforeEach(async () => {
		server = await buildTestServer({ subjectVerified: true });
	});
	afterEach(() => server.close());

	it("records token issuance", async () => {
		// WHY: the issued credential is the highest-impact mutation. A leaked admin
		// token that silently issues recruiter tokens would be invisible without this.
		const res = await server.adminFetch("/admin/api/tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ audience_hint: "Acme", purpose: "interviews" }),
		});
		const { token_id } = (await res.json()) as { token_id: string };

		const entries = server.adminAudit.list({ action: "token.issue" });
		expect(entries.length).toBe(1);
		expect(entries[0]!.target).toBe(token_id);
		expect(entries[0]!.details).toMatchObject({ audience_hint: "Acme", purpose: "interviews" });
	});

	it("records token revocation", async () => {
		const issued = await server.adminFetch("/admin/api/tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		const { token_id } = (await issued.json()) as { token_id: string };

		await server.adminFetch(`/admin/api/tokens/${token_id}`, { method: "DELETE" });

		const entries = server.adminAudit.list({ action: "token.revoke" });
		expect(entries.length).toBe(1);
		expect(entries[0]!.target).toBe(token_id);
	});

	it("records claim CRUD", async () => {
		// WHY: a compromised admin token rewriting a candidate's claims with a
		// recruiter watching is a credible attack. The audit trail makes it visible.
		const create = await server.adminFetch("/admin/api/claims", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "skill", value: { name: "Rust" } }),
		});
		const { claim } = (await create.json()) as { claim: { claim_id: string } };

		await server.adminFetch(`/admin/api/claims/${claim.claim_id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ value: { name: "Rust", level: "expert" } }),
		});
		await server.adminFetch(`/admin/api/claims/${claim.claim_id}`, { method: "DELETE" });

		const actions = server.adminAudit.list().map((e) => e.action);
		expect(actions).toContain("claim.create");
		expect(actions).toContain("claim.update");
		expect(actions).toContain("claim.delete");
		const create_entry = server.adminAudit.list({ action: "claim.create" })[0]!;
		expect(create_entry.target).toBe(claim.claim_id);
	});

	it("is read-only behind the admin bearer and is not exposed via MCP", async () => {
		// WHY: per §9.4 the audit log is candidate-private. The control-plane audit
		// inherits the same privacy: no MCP tool/resource may surface it.
		await server.adminFetch("/admin/api/tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});

		const unauth = await server.adminFetch("/admin/api/admin_audit", { noAuth: true });
		expect(unauth.status).toBe(401);

		const ok = await server.adminFetch("/admin/api/admin_audit");
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as { entries: { action: string }[] };
		expect(body.entries.length).toBeGreaterThanOrEqual(1);

		const toolsList = await server.request({ method: "tools/list" });
		const toolNames = toolsList.body.result.tools.map((t: any) => t.name);
		expect(toolNames.some((n: string) => n.includes("audit"))).toBe(false);
	});

	it("records handle changes (hosted)", async () => {
		// Spin up a hosted-mode server so the handle endpoint is reachable.
		const hosted = await buildTestServer({ subjectVerified: true, operatorType: "hosted" });
		try {
			await hosted.adminFetch("/admin/api/handle", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ handle: "alice" }),
			});
			const entries = hosted.adminAudit.list({ action: "handle.set" });
			expect(entries.length).toBe(1);
			expect(entries[0]!.target).toBe("alice");
		} finally {
			hosted.close();
		}
	});
});
