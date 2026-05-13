// #17 web-search adapter. Provider-abstract: a `search(query)` method returning a
// list of result objects. v0 ships the interface plus a `MockWebSearch` for tests
// and CI-only flows. The concrete provider impl (Tavily / Brave / Exa / etc.) is a
// follow-up — matches the BYO-API-key model from #6/#15 (clients ship their own
// key for the engines they choose). With no provider configured, the structurer
// still has a fall-through; it just sees an empty result list.
export interface WebSearchResult {
	url: string;
	title: string;
	snippet: string;
	fetched_at: string; // ISO-8601
}

export interface WebSearch {
	// Returns up to `limit` results for the query. Implementations decide how to
	// surface upstream failures: real providers should rethrow; the Mock simply
	// returns the registered fixture (or an empty array) and never throws.
	search(query: string, limit?: number): Promise<WebSearchResult[]>;
}

// Test-only adapter. Registered fixtures match by query substring (case-insensitive)
// so a single test can register one canned response and assert the structurer
// receives it for any reasonable phrasing of the query.
export class MockWebSearch implements WebSearch {
	private fixtures: { needle: string; results: WebSearchResult[] }[] = [];

	register(querySubstring: string, results: WebSearchResult[]): void {
		this.fixtures.push({ needle: querySubstring.toLowerCase(), results });
	}

	async search(query: string, limit?: number): Promise<WebSearchResult[]> {
		const q = query.toLowerCase();
		for (const f of this.fixtures) {
			if (q.includes(f.needle)) {
				return limit ? f.results.slice(0, limit) : f.results;
			}
		}
		return [];
	}
}
