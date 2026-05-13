// §7.2 — Endorser email verification yields an email_attested endorsement claim with a canonical payload_hash.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { canonicalizeForHash } from "../../../src/verification/endorser.js";

describe("§7.2 endorser email verification", () => {
	let server: TestServer;
	beforeEach(async () => {
		server = await buildTestServer({});
	});
	afterEach(() => server.close());

	async function startEndorsement(payload: unknown) {
		// #7 Phase 5: solicit now requires admin auth + completed subject verification.
		// The helper defaults to subjectVerified=true so the gate is satisfied here.
		return server.adminFetch("/admin/api/endorsement/solicit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});
	}

	it("sends a challenge email to the endorser containing the proposed endorsement text", async () => {
		const start = await startEndorsement({
			endorser_email: "bob@stripe.com",
			endorser_name: "Bob",
			value: { endorser_name: "Bob", summary: "Solid engineer." },
		});
		expect(start.status).toBe(202);
		expect(server.outbox().length).toBe(1);
		const mail = server.outbox()[0]!;
		expect(mail.to).toBe("bob@stripe.com");
		expect(mail.body).toContain("Solid engineer.");
	});

	it("completes verification and writes an email_attested endorsement claim", async () => {
		const value = { endorser_name: "Bob", summary: "Solid engineer.", relationship: "manager" };
		await startEndorsement({ endorser_email: "bob@stripe.com", endorser_name: "Bob", value });
		const mail = server.outbox()[0]!;
		const token = mail.body.match(/challenge=([a-z0-9_-]+)/i)?.[1];
		const complete = await server.rawFetch(`/admin/api/endorsement/complete?challenge=${token}`);
		expect(complete.status).toBe(200);

		const stored = server.claims.list().find((c) => c.type === "endorsement");
		expect(stored).toBeDefined();
		expect(stored!.attestation.level).toBe("email_attested");
	});

	it("records verifier_is_subject_host=true when verifier URL equals server operator URL", async () => {
		// WHY: §7.2 — the boolean exposes the common conflict-of-interest case.
		const value = { endorser_name: "Bob", summary: "X" };
		await startEndorsement({ endorser_email: "bob@stripe.com", endorser_name: "Bob", value });
		const mail = server.outbox()[0]!;
		const token = mail.body.match(/challenge=([a-z0-9_-]+)/i)?.[1];
		await server.rawFetch(`/admin/api/endorsement/complete?challenge=${token}`);
		const stored = server.claims.list().find((c) => c.type === "endorsement")!;
		const att: any = stored.attestation;
		expect(att.verification.verifier_url).toBe(server.operatorUrl);
		expect(att.verification.verifier_is_subject_host).toBe(true);
	});

	it("discloses only the endorser email domain by default (local part is opt-in)", async () => {
		// WHY: §7.2 — local part disclosure requires endorser opt-in. Default: domain only.
		const value = { endorser_name: "Bob", summary: "X" };
		await startEndorsement({ endorser_email: "bob@stripe.com", endorser_name: "Bob", value });
		const mail = server.outbox()[0]!;
		const token = mail.body.match(/challenge=([a-z0-9_-]+)/i)?.[1];
		await server.rawFetch(`/admin/api/endorsement/complete?challenge=${token}`);
		const att: any = server.claims.list().find((c) => c.type === "endorsement")!.attestation;
		expect(att.endorser_email_domain).toBe("stripe.com");
		expect(att.endorser_email_local).toBeUndefined();
	});

	it("includes local part when endorser opted in at completion", async () => {
		const value = { endorser_name: "Bob", summary: "X" };
		await startEndorsement({ endorser_email: "bob@stripe.com", endorser_name: "Bob", value });
		const mail = server.outbox()[0]!;
		const token = mail.body.match(/challenge=([a-z0-9_-]+)/i)?.[1];
		await server.rawFetch(`/admin/api/endorsement/complete?challenge=${token}&disclose_local=1`);
		const att: any = server.claims.list().find((c) => c.type === "endorsement")!.attestation;
		expect(att.endorser_email_local).toBe("bob");
	});

	it("payload_hash covers the canonicalized endorsement value", async () => {
		// WHY: §7.2 — payload_hash MUST cover the canonicalized parent claim value at verification time.
		// Stability of the canonicalization is what makes the record meaningful across servers.
		const value = { summary: "X", endorser_name: "Bob" };
		await startEndorsement({ endorser_email: "bob@stripe.com", endorser_name: "Bob", value });
		const mail = server.outbox()[0]!;
		const token = mail.body.match(/challenge=([a-z0-9_-]+)/i)?.[1];
		await server.rawFetch(`/admin/api/endorsement/complete?challenge=${token}`);
		const stored = server.claims.list().find((c) => c.type === "endorsement")!;
		const expected = canonicalizeForHash(stored.value);
		const att: any = stored.attestation;
		expect(att.verification.payload_hash).toBe(`sha256:${expected}`);
	});

	it("canonicalization is sort-stable across key orders", async () => {
		// WHY: §7.2 — the hash must be reproducible; key order in JSON must not affect the result.
		const a = canonicalizeForHash({ b: 1, a: 2 });
		const b = canonicalizeForHash({ a: 2, b: 1 });
		expect(a).toBe(b);
	});
});
