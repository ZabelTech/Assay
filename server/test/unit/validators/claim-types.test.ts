// §6.2 — Per-type value shape validation. One describe block per standard type.
import { describe, expect, it } from "vitest";
import { parseClaim } from "../../../src/domain/validators.js";

function withValue(type: string, value: unknown) {
	return {
		claim_id: `clm_${type}_001`,
		subject: "alice@example.com",
		type,
		value,
		attestation: { level: "self_attested" },
		visibility: "public",
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
	};
}

describe("§6.2 identity", () => {
	it("accepts name + headline + handles", () => {
		expect(() =>
			parseClaim(withValue("identity", { name: "Alice", headline: "Engineer", handles: { email: "a@b.co" } })),
		).not.toThrow();
	});
	it("requires name", () => {
		// WHY: §6.2 identity claim is the orientation point for any querying agent; missing name is malformed.
		expect(() => parseClaim(withValue("identity", { headline: "Engineer" }))).toThrow();
	});
});

describe("§6.2 employment", () => {
	const base = { employer: "Stripe", title: "SWE", start_date: "2021-03-01" };
	it("status=ended requires end_date", () => {
		// WHY: §6.2 — the status discriminator resolves the prior end_date:null ambiguity.
		expect(() => parseClaim(withValue("employment", { ...base, status: "ended", end_date: null }))).toThrow();
		expect(() => parseClaim(withValue("employment", { ...base, status: "ended", end_date: "2024-08-15" }))).not.toThrow();
	});
	it("status=current forbids non-null end_date", () => {
		// WHY: §6.2 — current means open-ended; a set end_date contradicts the status.
		expect(() => parseClaim(withValue("employment", { ...base, status: "current", end_date: "2024-08-15" }))).toThrow();
		expect(() => parseClaim(withValue("employment", { ...base, status: "current", end_date: null }))).not.toThrow();
	});
	it("status=undisclosed accepts null end_date and is distinguishable from current", () => {
		// WHY: §6.2 — "undisclosed" means deliberately withheld; agents SHOULD weight differently from current.
		const parsed = parseClaim(withValue("employment", { ...base, status: "undisclosed", end_date: null }));
		expect((parsed.value as any).status).toBe("undisclosed");
	});
	it("rejects unknown status values", () => {
		expect(() => parseClaim(withValue("employment", { ...base, status: "paused" }))).toThrow();
	});
});

describe("§6.2 education", () => {
	it("accepts institution + program + dates", () => {
		expect(() =>
			parseClaim(withValue("education", { institution: "TU Berlin", program: "M.Sc.", start_date: "2017-10-01" })),
		).not.toThrow();
	});
});

describe("§6.2 project", () => {
	it("accepts name + summary + role", () => {
		expect(() =>
			parseClaim(withValue("project", { name: "X", summary: "Y", role: "engineer", started_at: "2022-01-01" })),
		).not.toThrow();
	});
	it("requires a name", () => {
		expect(() => parseClaim(withValue("project", { summary: "Y" }))).toThrow();
	});
});

describe("§6.2 publication", () => {
	it("accepts a title + venue", () => {
		expect(() => parseClaim(withValue("publication", { title: "Paper", venue: "Conf" }))).not.toThrow();
	});
});

describe("§6.2 credential", () => {
	it("accepts a credential value with name + issuer", () => {
		expect(() => parseClaim(withValue("credential", { name: "AWS Solutions Architect", issuer: "AWS" }))).not.toThrow();
	});
});

describe("§6.2 skill", () => {
	it("accepts a skill referencing evidence claims", () => {
		expect(() =>
			parseClaim(withValue("skill", { name: "Distributed systems", level: "advanced", evidence_claims: ["clm_a"] })),
		).not.toThrow();
	});
});

describe("§6.2 endorsement", () => {
	it("accepts endorsement with optional relationship + worked_together_*", () => {
		// WHY: relationship + dates let agents reason about endorsement weight (current peer vs old manager).
		expect(() =>
			parseClaim(
				withValue("endorsement", {
					endorser_name: "Bob",
					summary: "Solid engineer.",
					relationship: "manager",
					worked_together_from: "2021-03-01",
					worked_together_until: "2024-08-15",
				}),
			),
		).not.toThrow();
	});
	it("rejects an unknown relationship value (must use x: namespace for custom)", () => {
		// WHY: §6.2 — relationship is an enum with explicit `x:` extension namespace.
		expect(() =>
			parseClaim(withValue("endorsement", { endorser_name: "Bob", summary: "Y", relationship: "boss" })),
		).toThrow();
	});
	it("accepts x:-namespaced relationship", () => {
		expect(() =>
			parseClaim(withValue("endorsement", { endorser_name: "Bob", summary: "Y", relationship: "x:advisor" })),
		).not.toThrow();
	});
});

describe("§6.2 availability", () => {
	it("accepts status + optional valid_until", () => {
		// WHY: §6.2 — valid_until is RECOMMENDED; agents SHOULD discount stale availability claims.
		expect(() =>
			parseClaim(withValue("availability", { status: "open_to_offers", valid_until: "2026-08-15" })),
		).not.toThrow();
	});
});

describe("§6.2 preference", () => {
	it("accepts free-form preferences", () => {
		expect(() => parseClaim(withValue("preference", { remote_only: true, notes: "no on-call" }))).not.toThrow();
	});
});

describe("§6.2 compensation", () => {
	it("accepts target_total with ISO 4217 currency", () => {
		expect(() =>
			parseClaim(withValue("compensation", { type: "target_total", base_min: 180000, currency: "EUR" })),
		).not.toThrow();
	});
	it("rejects unknown compensation.type", () => {
		// WHY: §6.2 — value.type MUST be target_total | current_total | historical. Unknown is malformed.
		expect(() => parseClaim(withValue("compensation", { type: "guess", base: 100000, currency: "EUR" }))).toThrow();
	});
	it("rejects a non-ISO-4217 currency", () => {
		// WHY: §6.2 — currency SHOULD be ISO 4217; we enforce as MUST for the structural validator.
		expect(() => parseClaim(withValue("compensation", { type: "target_total", base: 100, currency: "XX" }))).toThrow();
	});
});

describe("§6.2 narrative", () => {
	it("accepts text + optional scope", () => {
		expect(() => parseClaim(withValue("narrative", { text: "I'm most interested in...", scope: "general" }))).not.toThrow();
	});
	it("requires text", () => {
		expect(() => parseClaim(withValue("narrative", { scope: "general" }))).toThrow();
	});
});
