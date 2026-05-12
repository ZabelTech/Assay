// §6.3 / §8.1 — Custom claim and evidence types via x: namespace MUST be tolerated.
import { describe, expect, it } from "vitest";
import { parseClaim, parseEvidence } from "../../../src/domain/validators.js";

describe("§6.3 custom claim types", () => {
	it("accepts an x:-namespaced claim type with arbitrary value shape", () => {
		// WHY: §6.3 — "Conforming clients MUST NOT reject a career object containing custom claim types."
		expect(() =>
			parseClaim({
				claim_id: "clm_custom_001",
				subject: "alice@example.com",
				type: "x:security_clearance",
				value: { level: "TS/SCI", expires: "2027-01-01" },
				attestation: { level: "self_attested" },
				visibility: "permissioned",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
			}),
		).not.toThrow();
	});
	it("rejects unknown non-x:-namespaced types", () => {
		// WHY: §6.3 — only `x:` prefix grants pass-through. Bare unknown types are malformed.
		expect(() =>
			parseClaim({
				claim_id: "clm_x",
				subject: "alice@example.com",
				type: "security_clearance",
				value: {},
				attestation: { level: "self_attested" },
				visibility: "public",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
			}),
		).toThrow();
	});
});

describe("§8.1 custom evidence types", () => {
	it("accepts an x:-namespaced evidence type with arbitrary shape", () => {
		// WHY: §8.1 — clients MUST NOT reject custom evidence; SHOULD surface in raw form.
		expect(() => parseEvidence({ type: "x:dns_proof", record: "TXT", domain: "alice.dev" })).not.toThrow();
	});
});
