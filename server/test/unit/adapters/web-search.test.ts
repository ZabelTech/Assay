// #17 WebSearch adapter. The Mock is the only concrete impl in this PR (the
// real provider is a follow-up per the plan). These tests pin the fixture
// registration contract that the #15 structurer relies on.
import { describe, expect, it } from "vitest";
import { MockWebSearch } from "../../../src/adapters/web_search.js";

describe("MockWebSearch", () => {
	// WHY: the structurer is allowed to issue web queries at any extraction step;
	// it needs to receive registered fixtures regardless of exact query phrasing.
	// Substring + case-insensitive matching makes test fixtures robust to
	// rewording.
	it("returns registered results when the query contains the needle (case-insensitive)", async () => {
		const search = new MockWebSearch();
		search.register("staff platform engineer", [
			{ url: "https://example.com/1", title: "what is a staff engineer", snippet: "...", fetched_at: "2026-05-01" },
		]);

		const results = await search.search("Staff Platform Engineer career path");
		expect(results).toHaveLength(1);
		expect(results[0]!.url).toBe("https://example.com/1");
	});

	// WHY: a missing fixture must produce an empty array, never throw — the
	// structurer is supposed to proceed (and surface "no results" appropriately)
	// rather than have the pipeline crash on an unseeded query.
	it("returns an empty array for unregistered queries", async () => {
		const search = new MockWebSearch();
		const results = await search.search("anything");
		expect(results).toEqual([]);
	});

	// WHY: the structurer can pass a limit to cap how many results it spends
	// LLM context on. The Mock must honor it so tests can drive the structurer's
	// limit-handling path.
	it("respects an explicit limit", async () => {
		const search = new MockWebSearch();
		search.register("python", [
			{ url: "https://a", title: "a", snippet: "", fetched_at: "2026-05-01" },
			{ url: "https://b", title: "b", snippet: "", fetched_at: "2026-05-01" },
			{ url: "https://c", title: "c", snippet: "", fetched_at: "2026-05-01" },
		]);

		const results = await search.search("python", 2);
		expect(results.map((r) => r.url)).toEqual(["https://a", "https://b"]);
	});
});
