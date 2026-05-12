// §5 — Career object top-level shape.
import { describe, expect, it } from "vitest";
import { parseCareer } from "../../../src/domain/validators.js";

const validCareer = {
	"@context": ["https://schema.org", "https://cairn.dev/schemas/v0"],
	schema_version: "cairn/0.1",
	subject: "alice@example.com",
	updated_at: "2026-05-10T14:32:00Z",
	claims: [],
};

describe("§5 career object", () => {
	it("accepts the minimal valid shape", () => {
		// WHY: §5 lists @context, schema_version, subject, updated_at, claims as REQUIRED.
		expect(() => parseCareer(validCareer)).not.toThrow();
	});

	it("requires the Cairn v0 context to be present in @context", () => {
		// WHY: §5 — "MUST include the Cairn v0 context."
		const career = { ...validCareer, "@context": ["https://schema.org"] };
		expect(() => parseCareer(career)).toThrow(/cairn/i);
	});

	it("rejects when subject is missing", () => {
		// WHY: subject is the canonical identity (§4); the career object is meaningless without it.
		const { subject: _subject, ...rest } = validCareer;
		expect(() => parseCareer(rest)).toThrow();
	});

	it("rejects when subject is not an email shape", () => {
		// WHY: §4 requires subject to be an email; email-challenge verification depends on it.
		const career = { ...validCareer, subject: "not-an-email" };
		expect(() => parseCareer(career)).toThrow();
	});

	it("ignores unrecognized top-level fields rather than rejecting them", () => {
		// WHY: §5 — "Conforming clients MUST ignore unrecognized top-level fields." Forward-compat.
		const career = { ...validCareer, future_field: { whatever: true } };
		const parsed = parseCareer(career);
		expect(parsed.subject).toBe("alice@example.com");
	});

	it("requires schema_version to be cairn/0.1", () => {
		// WHY: §11 — servers MUST be able to serve their declared version.
		const career = { ...validCareer, schema_version: "cairn/0.2" };
		expect(() => parseCareer(career)).toThrow();
	});

	it("accepts an empty claims array", () => {
		// WHY: §5 says "May be empty." A subject with no claims is a valid empty career.
		const parsed = parseCareer(validCareer);
		expect(parsed.claims).toEqual([]);
	});
});
