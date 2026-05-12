// #7 admin claim CRUD with email_attested.value immutability.
//
// Direct create is rejected for `email_attested` (creation is solicit-flow-only, §7.2).
// `update` rejects mutations of `value` on email_attested claims to preserve the
// payload_hash integrity contract; visibility and other non-value fields stay mutable.
import type { Hono } from "hono";
import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { Claim, Visibility } from "../domain/types.js";
import { parseClaim } from "../domain/validators.js";
import { CairnError } from "../mcp/errors.js";
import { requireAdmin } from "./auth.js";

export interface AdminClaimDeps {
	claims: ClaimsRepo;
	subjects: SubjectRepo;
	adminTokens: AdminTokensRepo;
	defaultSubject: string;
}

export function mountAdminClaimRoutes(app: Hono, deps: AdminClaimDeps): void {
	const admin = requireAdmin(deps.adminTokens);

	const currentSubject = (): string => deps.subjects.getCurrentSubject() ?? deps.defaultSubject;

	app.post("/admin/api/claims", admin, async (c) => {
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || typeof body !== "object") return malformed(c, "missing body");
		const type = body.type;
		const value = body.value;
		if (typeof type !== "string") return malformed(c, "type required");
		if (!value || typeof value !== "object") return malformed(c, "value required");
		if (type.startsWith("x:")) {
			// #7: custom claim types (§6.3) are out of scope for the v0 admin API.
			return malformed(c, "custom claim types (§6.3) are out of scope for v0");
		}
		if (body.attestation && (body.attestation as { level?: string }).level === "email_attested") {
			// #7: direct creation of email_attested is forbidden; use the solicit flow.
			return malformed(c, "email_attested claims are created via the endorsement solicitation flow only");
		}
		const visibility = (body.visibility as Visibility | undefined) ?? defaultVisibility(type);
		const now = new Date().toISOString();
		const claim: Claim = {
			claim_id: `clm_${randomBytes(8).toString("hex")}`,
			subject: currentSubject(),
			type,
			value: value as Claim["value"],
			attestation: { level: "self_attested" },
			visibility,
			created_at: now,
			updated_at: now,
		};
		try {
			parseClaim(claim); // Reject custom (x:) types and shape errors.
		} catch (err) {
			return malformed(c, err instanceof Error ? err.message : String(err));
		}
		deps.claims.insert(claim);
		return c.json({ claim }, 201);
	});

	app.get("/admin/api/claims", admin, (c) => {
		const type = c.req.query("type") ?? undefined;
		const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
		const cursor = c.req.query("cursor") ?? undefined;
		const claims = deps.claims.list({ type, limit, cursor });
		return c.json({ claims });
	});

	app.get("/admin/api/claims/:claim_id", admin, (c) => {
		const claim = deps.claims.get(c.req.param("claim_id"));
		if (!claim) return notFound(c);
		return c.json({ claim });
	});

	app.put("/admin/api/claims/:claim_id", admin, async (c) => {
		const id = c.req.param("claim_id");
		const existing = deps.claims.get(id);
		if (!existing) return notFound(c);

		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || typeof body !== "object") return malformed(c, "missing body");

		const valueTouched = Object.prototype.hasOwnProperty.call(body, "value");
		if (valueTouched && existing.attestation.level === "email_attested") {
			// #7 immutability: value MUST NOT change on email_attested claims. Force
			// delete-and-re-solicit if the candidate wants different endorsement text.
			const err = new CairnError(
				"immutable_field",
				"value is immutable on email_attested claims; delete and re-solicit to change",
				{ claim_id: id, field: "value" },
			);
			return c.json({ error: err.toRpcError() }, 409);
		}

		const updated: Claim = {
			...existing,
			value: valueTouched ? (body.value as Claim["value"]) : existing.value,
			visibility: (body.visibility as Visibility | undefined) ?? existing.visibility,
			updated_at: new Date().toISOString(),
		};
		// Re-validate the (potentially new) value against the type schema. Skip for
		// email_attested where value didn't change.
		if (valueTouched) {
			try {
				parseClaim(updated);
			} catch (err) {
				return malformed(c, err instanceof Error ? err.message : String(err));
			}
		}
		deps.claims.insert(updated); // insert is upsert (INSERT OR REPLACE).
		return c.json({ claim: updated });
	});

	app.delete("/admin/api/claims/:claim_id", admin, (c) => {
		const id = c.req.param("claim_id");
		const ok = deps.claims.delete(id);
		if (!ok) return notFound(c);
		return c.body(null, 204);
	});
}

function defaultVisibility(type: string): Visibility {
	// #7: `compensation` defaults to `private`; everything else to `permissioned`.
	return type === "compensation" ? "private" : "permissioned";
}

function malformed(c: Context, message: string) {
	const err = new CairnError("malformed_input", message);
	return c.json({ error: err.toRpcError() }, 400);
}

function notFound(c: Context) {
	const err = new CairnError("claim_not_found", "claim not found");
	return c.json({ error: err.toRpcError() }, 404);
}
