// Environment config defaults. The interesting bit today is the CORS default:
// previously "*", now closed (empty list) so operators must opt in explicitly.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
	it("defaults CORS to closed (empty list) so cross-origin is opt-in", () => {
		// WHY: "*" by default would silently broaden the trust surface. Bearer-only
		// authN limits the immediate damage, but the default should match the
		// project's stated "fail loud" posture, not a permissive footgun.
		const cfg = loadConfig({ SUBJECT: "alice@example.com" });
		expect(cfg.corsOrigins).toEqual([]);
	});

	it("parses comma-separated CORS_ORIGINS and trims whitespace", () => {
		const cfg = loadConfig({
			SUBJECT: "alice@example.com",
			CORS_ORIGINS: "https://app.example.com, https://recruit.example.com",
		});
		expect(cfg.corsOrigins).toEqual([
			"https://app.example.com",
			"https://recruit.example.com",
		]);
	});

	it("filters out empty entries from CORS_ORIGINS so trailing commas are inert", () => {
		// WHY: a stray trailing comma like "https://x.com," shouldn't add an "" entry
		// which Hono's CORS middleware would treat as a literal origin match.
		const cfg = loadConfig({
			SUBJECT: "alice@example.com",
			CORS_ORIGINS: "https://x.com,,",
		});
		expect(cfg.corsOrigins).toEqual(["https://x.com"]);
	});
});
