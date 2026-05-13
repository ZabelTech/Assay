// #17 URL snapshot end-to-end through the pipeline. Pins:
//
// - "URL fetch produces both raw-artifact (in evidence-store, with
//    content_hash) and corpus markdown (with metadata linking them)."
// - "Published claims derived from URL sources carry raw-artifact
//    `document` evidence, not corpus references."
//
// The UrlSnapshotFetcher itself is pinned in unit/adapters/url-snapshot.test.ts;
// here we drive a URL ingest through pipeline.ingest with the normalizer
// registered and assert corpus + raw artifact + published-claim shape.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

let ts: TestServer;
beforeEach(async () => {
	ts = await buildTestServer();
});
afterEach(() => ts.close());

describe("#17 url-snapshot end-to-end", () => {
	// WHY: pins that url-snapshot source_type is a first-class pipeline
	// citizen — same normalize → corpus → metadata → raw-artifact pairing
	// as paste / pdf / OAuth. The test calls pipeline.ingest directly
	// rather than going through a route (the refresh-source route is
	// deferred per the plan); the rest of the pipeline behavior is what
	// we're pinning.
	it("ingest of url-snapshot writes corpus + raw artifact + metadata, all linked", async () => {
		ts.structurer.register("url-snapshot", [
			{
				type: "publication",
				value: {
					title: "Why your kubernetes pods keep dying",
					url: "https://example.com/post-1",
					source: "Example Blog",
				},
			},
		]);

		const rawBody = Buffer.from("<html><body>Why your kubernetes pods keep dying</body></html>", "utf8");
		const result = await ts.pipeline.ingest({
			raw: rawBody,
			source_type: "url-snapshot",
			source_url: "https://example.com/post-1",
			rawMediaType: "text/html",
			subject: ts.subject,
		});

		// Corpus + raw artifact are both captured and linked via SQLite
		// metadata.
		expect(result.corpus_paths).toHaveLength(1);
		const corpusPath = result.corpus_paths[0]!.path;
		const meta = ts.corpusMetadata.getLatest(ts.subject, corpusPath)!;
		expect(meta.source_type).toBe("url-snapshot");
		expect(meta.source_url).toBe("https://example.com/post-1");
		expect(meta.raw_storage_ref).toMatch(/^cairn:\/\/evidence\//);
		expect(meta.raw_content_hash).toMatch(/^sha256:/);
		expect(meta.raw_media_type).toBe("text/html");

		// And the raw artifact is retrievable from evidence-store with the
		// content_hash recorded above.
		const stored = ts.evidenceStore.get(meta.raw_storage_ref!)!;
		expect(stored.toString("utf8")).toBe(rawBody.toString("utf8"));
	});

	// WHY: pins #17's invariant that published claims derived from URL
	// sources carry raw-artifact document evidence (not the corpus path).
	// Plus a `url` evidence linking to the source URL — both are part of
	// the §8 evidence spec.
	it("publish on a url-snapshot draft yields document + url evidence with content_hash", async () => {
		ts.structurer.register("url-snapshot", [
			{
				type: "publication",
				value: { title: "Article", url: "https://example.com/a", source: "Example" },
			},
		]);
		const ingest = await ts.pipeline.ingest({
			raw: "<html>Article body about distributed systems</html>",
			source_type: "url-snapshot",
			source_url: "https://example.com/a",
			rawMediaType: "text/html",
			subject: ts.subject,
		});
		const publish = await ts.pipeline.publish({
			draft_ids: ingest.drafts.map((d) => d.draft_id),
			subject: ts.subject,
		});
		const claim = ts.claims.get(publish.claim_ids[0]!)!;
		expect(claim.evidence).toBeDefined();
		const doc = claim.evidence!.find((e) => e.type === "document") as { content_hash: string; document_url: string };
		expect(doc).toBeDefined();
		expect(doc.content_hash).toMatch(/^sha256:/);
		expect(doc.document_url).toMatch(/^cairn:\/\/evidence\//);
		// And a `url` evidence entry pointing at the source URL.
		const url = claim.evidence!.find((e) => e.type === "url") as { url: string };
		expect(url).toBeDefined();
		expect(url.url).toBe("https://example.com/a");
		// No corpus path leaks into any field.
		expect(JSON.stringify(claim)).not.toMatch(/\.v\d+\.md|candidate-corpus/);
	});
});
