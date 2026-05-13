// #15 hard privacy boundary: corpus is admin-API only, NEVER reachable
// from the MCP endpoint. Pins:
//
// - "Corpus is unreachable from the MCP endpoint; tests assert this."
// - "A test fetches a published claim via MCP and asserts: (a) every
//    evidence entry resolves to a raw artifact, (b) no corpus path
//    appears in any serialized field."
//
// The original PR-C MCP-isolation test checked tools/list, resources/list,
// list_claims. This file extends coverage to get_claim, query_career, and
// the three resources (identity, schema, server_info) — the full MCP
// surface a recruiter could exercise.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";

interface DraftsResponse {
	drafts: Array<{ draft_id: string }>;
}

const CORPUS_LEAK_PATTERN = /candidate-corpus|\.v\d+\.md|paste\.md|linkedin\.md|github\.md|sources\//;

let ts: TestServer;
beforeEach(async () => {
	ts = await buildTestServer();
	// Seed an identity claim so the identity resource has something to
	// return — without it the resource path is trivially empty and the
	// test wouldn't exercise anything meaningful.
	ts.claims.insert({
		claim_id: "clm_identity_seed",
		subject: ts.subject,
		type: "identity",
		value: { name: "Alice", email: ts.subject },
		attestation: { level: "self_attested" },
		visibility: "public",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	});
});
afterEach(() => ts.close());

describe("#15 MCP corpus isolation — full endpoint coverage", () => {
	// Build a published claim WITH corpus origin so the publish path
	// auto-attaches the corpus document evidence. Then poke every MCP
	// endpoint and assert no corpus path leaks anywhere.
	async function seedPublishedClaim(): Promise<string> {
		ts.structurer.register("paste", [
			{
				type: "publication",
				value: {
					title: "Things I learned about TypeScript types",
					url: "https://example.com/x",
					source: "blog",
				},
			},
		]);
		const importRes = await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "I wrote about TypeScript types and how they work" }),
		});
		const { drafts } = (await importRes.json()) as DraftsResponse;
		const pubRes = await ts.adminFetch("/admin/api/drafts/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ draft_ids: drafts.map((d) => d.draft_id) }),
		});
		const { claim_ids } = (await pubRes.json()) as { claim_ids: string[] };
		return claim_ids[0]!;
	}

	// WHY: pins the full evidence-rewrite invariant for the publish path.
	// Every evidence entry on a claim fetched via MCP resolves to a raw
	// artifact key (cairn://evidence/...) or a `url` reference — never a
	// candidate-corpus path. A leak here would expose markdown the
	// candidate considered private.
	it("get_claim returns a claim whose evidence points only at raw artifacts / urls", async () => {
		const claim_id = await seedPublishedClaim();
		const issued = ts.issueToken();
		const res = await ts.request({
			method: "tools/call",
			params: { name: "get_claim", arguments: { claim_id } },
			token: issued.token,
		});
		const json = JSON.stringify(res.body);
		expect(json).not.toMatch(CORPUS_LEAK_PATTERN);
		// And specifically pin that the document evidence URL is a raw
		// artifact key.
		const claim = (res.body as { result: { claim: { evidence: { type: string; document_url?: string }[] } } })
			.result.claim;
		const doc = claim.evidence?.find((e) => e.type === "document");
		expect(doc?.document_url).toMatch(/^cairn:\/\/evidence\//);
	});

	// WHY: query_career invokes the synthesizer; if any code path were to
	// pass corpus content through the synthesis layer (a future bug), this
	// would catch it. The synthesizer in v0 is the StubSynthesizer; the
	// test still pins the boundary.
	it("query_career response never contains corpus paths", async () => {
		await seedPublishedClaim();
		const issued = ts.issueToken();
		const res = await ts.request({
			method: "tools/call",
			params: { name: "query_career", arguments: { information_needed: "TypeScript publications" } },
			token: issued.token,
		});
		expect(JSON.stringify(res.body)).not.toMatch(CORPUS_LEAK_PATTERN);
	});

	// WHY: the three resources (identity, schema, server_info) are the
	// other surface a permissioned token can hit. The identity resource is
	// the most interesting — it returns the seeded identity claim with
	// whatever evidence is attached. If the auto-evidence-attach for
	// corpus origin ever fired on a self_attested identity claim, this
	// test would catch the leak.
	it.each(["cairn://identity", "cairn://schema", "cairn://server_info"])(
		"resource %s never returns a corpus path",
		async (uri) => {
			const issued = ts.issueToken();
			const res = await ts.request({
				method: "resources/read",
				params: { uri },
				token: issued.token,
			});
			expect(JSON.stringify(res.body)).not.toMatch(CORPUS_LEAK_PATTERN);
		},
	);
});
