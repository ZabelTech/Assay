// §8 — Evidence type structural validation. v0 has four: url, document, image, screenshot.
import { describe, expect, it } from "vitest";
import { parseEvidence } from "../../../src/domain/validators.js";

const sha = `sha256:${"a".repeat(64)}`;

describe("§8.2 url evidence", () => {
	it("accepts type + url + label", () => {
		expect(() => parseEvidence({ type: "url", url: "https://github.com/alice/x", label: "Source" })).not.toThrow();
	});
	it("rejects non-https/http URL", () => {
		// WHY: HTTPS is REQUIRED for tokenized endpoints (§9.5); for evidence we accept http but reject file://
		// as a basic safety floor against local-file pointers in a hosted server context.
		expect(() => parseEvidence({ type: "url", url: "file:///etc/passwd" })).toThrow();
	});
});

describe("§8.3 document evidence", () => {
	const base = {
		type: "document",
		document_url: "https://alice.career/evidence/offer.pdf",
		content_hash: sha,
		media_type: "application/pdf",
		uploaded_at: "2024-09-02T10:14:00Z",
	};
	it("accepts a minimal valid document", () => {
		expect(() => parseEvidence(base)).not.toThrow();
	});
	it("requires sha256 content_hash format", () => {
		// WHY: §8.3 — hash provides integrity. A wrong-shape hash means the agent can't verify against the file.
		expect(() => parseEvidence({ ...base, content_hash: "md5:abc" })).toThrow();
		expect(() => parseEvidence({ ...base, content_hash: "not-a-hash" })).toThrow();
	});
	for (const f of ["document_url", "content_hash", "media_type", "uploaded_at"]) {
		it(`requires ${f}`, () => {
			const { [f]: _, ...rest } = base as Record<string, unknown>;
			expect(() => parseEvidence(rest)).toThrow();
		});
	}
});

describe("§8.4 image evidence", () => {
	const base = {
		type: "image",
		image_url: "https://alice.career/evidence/badge.jpg",
		content_hash: sha,
		media_type: "image/jpeg",
		uploaded_at: "2023-11-04T15:22:00Z",
		capture: { location_present: false },
	};
	it("accepts a minimal valid image with capture metadata", () => {
		expect(() => parseEvidence(base)).not.toThrow();
	});
	it("rejects raw GPS coordinates in capture", () => {
		// WHY: §8.5 — Servers MUST NOT surface raw GPS coordinates unless candidate explicitly opts in.
		// The structural validator forbids the field; the opt-in path is a different code path.
		expect(() =>
			parseEvidence({ ...base, capture: { ...base.capture, gps: { lat: 52.5, lon: 13.4 } } }),
		).toThrow();
	});
	it("surfaces location_present as a boolean", () => {
		const parsed: any = parseEvidence(base);
		expect(typeof parsed.capture.location_present).toBe("boolean");
	});
});

describe("§8.5 screenshot evidence", () => {
	const base = {
		type: "screenshot",
		image_url: "https://alice.career/evidence/slack.png",
		content_hash: sha,
		media_type: "image/png",
		uploaded_at: "2023-08-22T18:00:00Z",
		claimed_authenticity: "self_captured",
	};
	it("accepts a minimal screenshot", () => {
		expect(() => parseEvidence(base)).not.toThrow();
	});
	it("rejects unknown claimed_authenticity values", () => {
		// WHY: §8.6 — enum is self_captured | received_from_third_party | extracted_from_archive.
		expect(() => parseEvidence({ ...base, claimed_authenticity: "definitely_real" })).toThrow();
	});
	it("is structurally distinct from image (no capture object)", () => {
		// WHY: §8.6 — screenshots and photographs have different trust profiles; the wire format reflects this.
		const parsed: any = parseEvidence(base);
		expect(parsed.type).toBe("screenshot");
		expect(parsed.capture).toBeUndefined();
	});
});
