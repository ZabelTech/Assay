// #7 evidence attach/replace/remove. Four types: url (reference), document, image,
// screenshot (uploaded). Per spec §8 the server stores a content hash for uploaded types.
//
// Per-type metadata round-trips: document.extracted/redactions, image.capture (with raw
// GPS gated behind explicit candidate opt-in per §8.4), screenshot.context/claimed_authenticity.
import type { Hono, Context } from "hono";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { EvidenceStore } from "../adapters/evidence_store.js";
import type { Claim, Evidence } from "../domain/types.js";
import { CairnError } from "../mcp/errors.js";
import { requireAdmin } from "./auth.js";

export interface AdminEvidenceDeps {
	claims: ClaimsRepo;
	adminTokens: AdminTokensRepo;
	evidenceStore: EvidenceStore;
}

const SCREENSHOT_AUTH = new Set(["self_captured", "received_from_third_party", "extracted_from_archive"]);

export function mountAdminEvidenceRoutes(app: Hono, deps: AdminEvidenceDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	app.post("/admin/api/claims/:claim_id/evidence", admin, async (c) => {
		const id = c.req.param("claim_id");
		const claim = deps.claims.get(id);
		if (!claim) return notFound(c);
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) return malformed(c, "missing body");
		let evidence: Evidence;
		try {
			evidence = buildEvidence(body, deps.evidenceStore);
		} catch (err) {
			return malformed(c, err instanceof Error ? err.message : String(err));
		}
		const updated: Claim = {
			...claim,
			evidence: [...(claim.evidence ?? []), evidence],
			updated_at: new Date().toISOString(),
		};
		deps.claims.insert(updated);
		return c.json({ evidence, index: (updated.evidence?.length ?? 1) - 1 }, 201);
	});

	app.put("/admin/api/claims/:claim_id/evidence/:idx", admin, async (c) => {
		const id = c.req.param("claim_id");
		const idx = Number(c.req.param("idx"));
		const claim = deps.claims.get(id);
		if (!claim) return notFound(c);
		const existing = claim.evidence?.[idx];
		if (!existing) return notFound(c);

		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) return malformed(c, "missing body");
		let evidence: Evidence;
		try {
			evidence = buildEvidence(body, deps.evidenceStore);
		} catch (err) {
			return malformed(c, err instanceof Error ? err.message : String(err));
		}
		// Best-effort: free the prior blob if it was an uploaded type.
		const priorUrl = (existing as { document_url?: string; image_url?: string }).document_url ??
			(existing as { image_url?: string }).image_url;
		if (priorUrl) deps.evidenceStore.delete(priorUrl);

		const nextEvidence = [...(claim.evidence ?? [])];
		nextEvidence[idx] = evidence;
		deps.claims.insert({ ...claim, evidence: nextEvidence, updated_at: new Date().toISOString() });
		return c.json({ evidence, index: idx });
	});

	app.delete("/admin/api/claims/:claim_id/evidence/:idx", admin, (c) => {
		const id = c.req.param("claim_id");
		const idx = Number(c.req.param("idx"));
		const claim = deps.claims.get(id);
		if (!claim) return notFound(c);
		const existing = claim.evidence?.[idx];
		if (!existing) return notFound(c);

		const priorUrl = (existing as { document_url?: string; image_url?: string }).document_url ??
			(existing as { image_url?: string }).image_url;
		if (priorUrl) deps.evidenceStore.delete(priorUrl);

		const nextEvidence = (claim.evidence ?? []).filter((_, i) => i !== idx);
		deps.claims.insert({ ...claim, evidence: nextEvidence, updated_at: new Date().toISOString() });
		return c.body(null, 204);
	});
}

function buildEvidence(body: Record<string, unknown>, store: EvidenceStore): Evidence {
	const type = body.type;
	const now = new Date().toISOString();
	switch (type) {
		case "url": {
			if (typeof body.url !== "string") throw new Error("url required");
			const ev: Record<string, unknown> = { type: "url", url: body.url };
			if (body.label) ev.label = body.label;
			return ev as unknown as Evidence;
		}
		case "document": {
			const { buffer, mediaType } = decodeUpload(body);
			const { stored_url, content_hash } = store.put(buffer, mediaType);
			const ev: Record<string, unknown> = {
				type: "document",
				document_url: stored_url,
				content_hash,
				media_type: mediaType,
				uploaded_at: now,
			};
			if (body.label) ev.label = body.label;
			if (body.extracted && typeof body.extracted === "object") ev.extracted = body.extracted;
			if (Array.isArray(body.redactions)) ev.redactions = body.redactions;
			return ev as unknown as Evidence;
		}
		case "image": {
			const { buffer, mediaType } = decodeUpload(body);
			const { stored_url, content_hash } = store.put(buffer, mediaType);
			const ev: Record<string, unknown> = {
				type: "image",
				image_url: stored_url,
				content_hash,
				media_type: mediaType,
				uploaded_at: now,
			};
			if (body.label) ev.label = body.label;
			if (body.capture && typeof body.capture === "object") {
				// #7 / §8.4 — raw GPS stripped unless include_gps === true.
				const capture = { ...(body.capture as Record<string, unknown>) };
				if (body.include_gps !== true) delete capture.raw_gps;
				ev.capture = capture;
			}
			return ev as unknown as Evidence;
		}
		case "screenshot": {
			const { buffer, mediaType } = decodeUpload(body);
			const { stored_url, content_hash } = store.put(buffer, mediaType);
			const ev: Record<string, unknown> = {
				type: "screenshot",
				image_url: stored_url,
				content_hash,
				media_type: mediaType,
				uploaded_at: now,
			};
			if (body.label) ev.label = body.label;
			if (typeof body.context === "string") ev.context = body.context;
			if (typeof body.claimed_authenticity === "string") {
				if (!SCREENSHOT_AUTH.has(body.claimed_authenticity)) {
					throw new Error(`unknown claimed_authenticity "${body.claimed_authenticity}"`);
				}
				ev.claimed_authenticity = body.claimed_authenticity;
			}
			if (Array.isArray(body.redactions)) ev.redactions = body.redactions;
			return ev as unknown as Evidence;
		}
		default:
			throw new Error(`unknown evidence type "${type}"`);
	}
}

function decodeUpload(body: Record<string, unknown>): { buffer: Buffer; mediaType: string } {
	if (typeof body.data_base64 !== "string") throw new Error("data_base64 required");
	if (typeof body.media_type !== "string") throw new Error("media_type required");
	return { buffer: Buffer.from(body.data_base64, "base64"), mediaType: body.media_type };
}

function malformed(c: Context, message: string) {
	const err = new CairnError("malformed_input", message);
	return c.json({ error: err.toRpcError() }, 400);
}

function notFound(c: Context) {
	const err = new CairnError("claim_not_found", "claim or evidence index not found");
	return c.json({ error: err.toRpcError() }, 404);
}
