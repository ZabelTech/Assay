// #15 — per-source pipeline coverage. The top acceptance bullet for #15 says
// the same pipeline path runs for every source (`linkedin`, `github`,
// `pdf`, `paste`). The original PR-C tests cover paste; this file pins
// pdf / linkedin / github separately at the pipeline level: each writes
// the right primary corpus path, captures a raw artifact, and produces
// drafts pinned at the correct origin.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { MockOAuthProvider } from "../../../src/adapters/oauth.js";

interface DraftsResponse {
	drafts: Array<{
		draft_id: string;
		source: string;
		type: string;
		origin?: { path: string; version: number }[];
	}>;
}

let ts: TestServer;
beforeEach(async () => {
	ts = await buildTestServer();
});
afterEach(() => ts.close());

describe("#15 pipeline coverage — pdf", () => {
	// WHY: pins that the pdf path produces corpus + raw + metadata with
	// raw_media_type='application/pdf'. The PdfNormalizer chains through
	// the existing #7 PdfParser; pinning the chain works end-to-end.
	it("pdf import writes pdf.md corpus + raw artifact with application/pdf media type", async () => {
		ts.structurer.register("pdf", [
			{
				type: "employment",
				value: {
					employer: "Stripe",
					title: "Senior Engineer",
					start_date: "2022-01-01",
					status: "current",
				},
			},
		]);
		const pdfBytes = Buffer.from("résumé contents (pseudo-PDF for the mock parser)");
		const res = await ts.adminFetch("/admin/api/import/pdf", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data_base64: pdfBytes.toString("base64") }),
		});
		expect(res.status).toBe(201);
		const { drafts } = (await res.json()) as DraftsResponse;
		expect(drafts[0]!.origin).toEqual([{ path: "pdf.md", version: 1 }]);

		const meta = ts.corpusMetadata.getLatest(ts.subject, "pdf.md")!;
		expect(meta.source_type).toBe("pdf");
		expect(meta.raw_media_type).toBe("application/pdf");
		expect(meta.raw_storage_ref).toMatch(/^cairn:\/\/evidence\//);
	});
});

describe("#15 pipeline coverage — linkedin OAuth", () => {
	// WHY: pins that linkedin OAuth ingest writes linkedin.md plus per-
	// article sub-files (linkedin/articles/<slug>.md), with the right
	// source_type tagging at both levels.
	it("linkedin OAuth import writes linkedin.md PLUS per-article corpus files", async () => {
		const linkedin = ts.oauthProviders.get("linkedin")! as MockOAuthProvider;
		linkedin.registerProfile(
			"mock-linkedin-abc",
			JSON.stringify({
				name: "Alice",
				headline: "Senior Engineer",
				profile_url: "https://www.linkedin.com/in/alice",
				articles: [
					{ slug: "my-thoughts-on-types", title: "My thoughts on types", body: "Types are good.", url: "https://lnkd.in/types" },
				],
			}),
		);
		ts.structurer.register("linkedin", [
			{ type: "identity", value: { name: "Alice", email: ts.subject } },
		]);

		const start = await ts.adminFetch("/admin/api/import/oauth/linkedin/start", { method: "POST" });
		const { state } = (await start.json()) as { state: string };
		const callback = await ts.adminFetch(
			`/admin/api/import/oauth/linkedin/callback?code=abc&state=${encodeURIComponent(state)}`,
		);
		expect(callback.status).toBe(201);

		// Primary corpus file: linkedin.md, source_type=linkedin.
		const primary = ts.corpusMetadata.getLatest(ts.subject, "linkedin.md")!;
		expect(primary).toBeDefined();
		expect(primary.source_type).toBe("linkedin");
		expect(primary.source_url).toBe("https://www.linkedin.com/in/alice");

		// Sub-item: per-article file under linkedin/articles/.
		const article = ts.corpusMetadata.getLatest(ts.subject, "linkedin/articles/my-thoughts-on-types.md")!;
		expect(article).toBeDefined();
		// Sub-item preserves source_type=linkedin (the path encodes the
		// sub-kind, the field encodes the provider per #15 spec).
		expect(article.source_type).toBe("linkedin");
		expect(article.source_url).toBe("https://lnkd.in/types");
	});
});

describe("#15 pipeline coverage — github OAuth", () => {
	// WHY: same shape as linkedin — pins that github writes github.md plus
	// per-repo sub-files, both tagged source_type=github.
	it("github OAuth import writes github.md PLUS per-repo corpus files", async () => {
		const gh = ts.oauthProviders.get("github")! as MockOAuthProvider;
		gh.registerProfile(
			"mock-github-y",
			JSON.stringify({
				login: "alice",
				profile_url: "https://github.com/alice",
				repos: [
					{ name: "field-notes", owner: "alice", url: "https://github.com/alice/field-notes", description: "notes", readme: "..." },
				],
			}),
		);
		ts.structurer.register("github", [
			{
				type: "project",
				value: { name: "field-notes", url: "https://github.com/alice/field-notes" },
			},
		]);

		const start = await ts.adminFetch("/admin/api/import/oauth/github/start", { method: "POST" });
		const { state } = (await start.json()) as { state: string };
		const callback = await ts.adminFetch(
			`/admin/api/import/oauth/github/callback?code=y&state=${encodeURIComponent(state)}`,
		);
		expect(callback.status).toBe(201);

		const primary = ts.corpusMetadata.getLatest(ts.subject, "github.md")!;
		expect(primary).toBeDefined();
		expect(primary.source_type).toBe("github");

		const repo = ts.corpusMetadata.getLatest(ts.subject, "github/repos/alice-field-notes.md")!;
		expect(repo).toBeDefined();
		expect(repo.source_type).toBe("github");
		expect(repo.source_url).toBe("https://github.com/alice/field-notes");
	});
});
