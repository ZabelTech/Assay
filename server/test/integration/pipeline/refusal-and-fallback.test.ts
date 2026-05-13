// #15 — pipeline refusal paths and validation fallback. Pins:
//
// - "Verifier rejection path: a stub Verifier returning {ok: false} causes
//    the pipeline to reject the publish and surface reason via the admin
//    API."
// - "Drafts pass per-type value validation; failures fall back to a
//    narrative wrapper that preserves the extracted text (not dropped
//    silently)."
// - "Provenance check: a synthetic draft injected directly into the publish
//    path (bypassing the structurer) with no corpus grounding is rejected
//    by the Verifier; the candidate sees the unsupported text surfaced."
//   (This bullet's "no corpus grounding" half is partially tested here:
//    the SubstringVerifier rejects when the draft's strings aren't in the
//    cited corpus — a draft with no corpus grounding at all would have to
//    be inserted via direct DB access, which we don't support without
//    bypassing the pipeline entirely; what we DO pin is the rejection-
//    surfaces-reason path that catches the same class of error.)
// - "Pipeline refuses a draft with no origin pointer." (We use a custom
//    stub Structurer that returns a draft with origin=[] and assert the
//    pipeline throws at ingest.)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer, type TestServer } from "../../helpers/server.js";
import { SubstringVerifier, type Verifier } from "../../../src/adapters/verifier.js";

interface DraftsResponse {
	drafts: Array<{ draft_id: string; type: string; value: Record<string, unknown> }>;
}

describe("#15 publish refusal — Verifier returning {ok:false}", () => {
	let ts: TestServer;
	beforeEach(async () => {
		// Use the real SubstringVerifier so the publish rejection is driven
		// by actual provenance failure, not by a custom stub.
		ts = await buildTestServer({ verifier: new SubstringVerifier() });
	});
	afterEach(() => ts.close());

	// WHY: load-bearing. The candidate-facing surface for "your draft
	// wasn't grounded" must return 400 with the verifier's reason text in
	// the response body. A 500 / silent drop here would let hallucinations
	// land as claims.
	it("publish returns 400 with the verifier's reason when corpus doesn't ground the draft", async () => {
		ts.structurer.register("paste", [
			// `Galactic Emperor` doesn't appear in the corpus body below;
			// SubstringVerifier rejects, the pipeline surfaces the reason.
			{ type: "skill", value: { name: "Galactic Emperor of Concurrency" } },
		]);
		const importRes = await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "I write Rust" }),
		});
		const { drafts } = (await importRes.json()) as DraftsResponse;

		const publishRes = await ts.adminFetch("/admin/api/drafts/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ draft_ids: [drafts[0]!.draft_id] }),
		});
		expect(publishRes.status).toBe(400);
		const body = (await publishRes.json()) as { error: { message: string } };
		expect(body.error.message).toMatch(/galactic emperor/i);
		// And the draft is still in the queue — the candidate gets a chance
		// to fix or drop it. Silent acceptance would be the worse failure.
		expect(ts.drafts.list().some((d) => d.draft_id === drafts[0]!.draft_id)).toBe(true);
	});
});

describe("#15 per-type validation fallback to narrative", () => {
	let ts: TestServer;
	beforeEach(async () => {
		ts = await buildTestServer();
	});
	afterEach(() => ts.close());

	// WHY: pins rule 11 (fail loud). A draft whose value doesn't fit the
	// per-type schema must be wrapped in a `narrative` claim preserving
	// the original text — never dropped silently. Wrapper is the
	// documented behavior, surfaced to the candidate in review.
	it("invalid employment value falls back to narrative with the original text preserved", async () => {
		// employmentValueZ requires employer + title + start_date + status.
		// This fixture is missing start_date AND status — invalid.
		ts.structurer.register("paste", [
			{ type: "employment", value: { employer: "Acme", title: "Engineer" } },
		]);
		const res = await ts.adminFetch("/admin/api/import/paste", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "I was an Engineer at Acme" }),
		});
		const { drafts } = (await res.json()) as DraftsResponse;
		expect(drafts).toHaveLength(1);
		expect(drafts[0]!.type).toBe("narrative");
		// The original (invalid) value is preserved as text inside the
		// narrative wrapper — the candidate can read it and decide.
		expect(JSON.parse(drafts[0]!.value.text as string)).toEqual({
			employer: "Acme",
			title: "Engineer",
		});
		// And the scope field signals it was a validation-fallback wrapper
		// for downstream consumers / UI badges.
		expect(drafts[0]!.value.scope).toBe("employment_validation_fallback");
	});
});

// A test-only stub structurer whose `structure()` returns a draft with no
// origin pointers. The pipeline must refuse to persist it (rule from
// #15: "Drafts without an origin pointer are refused by the pipeline").
class OriginlessStructurer {
	async structure() {
		return {
			drafts: [{ type: "skill", value: { name: "X" }, origin: [] }],
			conflicts: [],
		};
	}
}

describe("#15 pipeline refuses a draft with no origin pointer", () => {
	// WHY: load-bearing structural rule. Every draft cites at least one
	// corpus file as its origin. If a structurer ever returns a draft with
	// no origin (LLM bug, mock misconfiguration), the pipeline must refuse
	// rather than persist an unattributable draft.
	it("ingest throws and the draft never lands in claim_drafts", async () => {
		const ts = await buildTestServer();
		try {
			// Replace the structurer instance the pipeline holds with the
			// OriginlessStructurer for this test. The pipeline doesn't
			// expose a setter, so we mutate the field directly — admissible
			// in a test harness.
			(ts.pipeline as unknown as { deps: { structurer: unknown } }).deps.structurer = new OriginlessStructurer();
			const before = ts.drafts.list().length;
			const res = await ts.adminFetch("/admin/api/import/paste", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "anything" }),
			});
			expect(res.status).toBe(400);
			expect(ts.drafts.list().length).toBe(before);
		} finally {
			ts.close();
		}
	});
});

// Stub that always rejects — used by the next test to confirm the pipeline
// surfaces a custom verifier's failure reason verbatim.
class RejectingVerifier implements Verifier {
	async verify() {
		return { ok: false as const, reason: "stub-verifier-rejected-everything" };
	}
}

describe("#15 publish rejection surfaces a custom verifier's reason", () => {
	// WHY: pins that the pipeline doesn't swallow the verifier's
	// `reason` — the candidate sees the exact failure text. Critical for
	// debuggability when a future LlmVerifier returns nuanced explanations.
	it("custom Verifier returning ok=false surfaces the reason string in the admin error", async () => {
		const ts = await buildTestServer({ verifier: new RejectingVerifier() });
		try {
			ts.structurer.register("paste", [{ type: "skill", value: { name: "TypeScript" } }]);
			const importRes = await ts.adminFetch("/admin/api/import/paste", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "I know TypeScript" }),
			});
			const { drafts } = (await importRes.json()) as DraftsResponse;
			const pubRes = await ts.adminFetch("/admin/api/drafts/publish", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ draft_ids: [drafts[0]!.draft_id] }),
			});
			expect(pubRes.status).toBe(400);
			const body = (await pubRes.json()) as { error: { message: string } };
			expect(body.error.message).toMatch(/stub-verifier-rejected-everything/);
		} finally {
			ts.close();
		}
	});
});
