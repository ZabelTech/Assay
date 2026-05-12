// §6.1 — Every claim must carry the common envelope fields.
import { describe, expect, it } from "vitest";
import { parseClaim } from "../../../src/domain/validators.js";

const base = {
	claim_id: "clm_test_001",
	subject: "alice@example.com",
	type: "narrative",
	value: { text: "Hello." },
	attestation: { level: "self_attested" },
	visibility: "public",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

describe("§6.1 claim envelope", () => {
	it("accepts a minimal valid claim", () => {
		expect(() => parseClaim(base)).not.toThrow();
	});

	for (const field of ["claim_id", "subject", "type", "value", "attestation", "visibility", "created_at", "updated_at"]) {
		it(`rejects when ${field} is missing`, () => {
			// WHY: §6.1 lists all eight as REQUIRED. A claim without any one of them cannot be reasoned about.
			const { [field]: _, ...rest } = base as Record<string, unknown>;
			expect(() => parseClaim(rest)).toThrow();
		});
	}

	it("rejects an unknown visibility value", () => {
		// WHY: §9 enumerates exactly three values. Anything else is undefined and unsafe to serve.
		expect(() => parseClaim({ ...base, visibility: "shared" })).toThrow();
	});

	it("accepts evidence as an optional array", () => {
		// WHY: §6.1 — evidence is OPTIONAL.
		const parsed = parseClaim({ ...base, evidence: [{ type: "url", url: "https://example.com" }] });
		expect(parsed.evidence).toHaveLength(1);
	});
});
