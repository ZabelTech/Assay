// MCP transport: Hono routes for /mcp with three token forms; JSON-RPC dispatch;
// CORS, rate-limit, size-limit middleware.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import type { AuditRepo } from "../storage/audit.repo.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { SubjectRepo } from "../storage/subject.repo.js";
import type { TokensRepo } from "../storage/tokens.repo.js";
import type { EvidenceStore } from "../adapters/evidence_store.js";
import type { Mailer } from "../adapters/mailer.js";
import type { Synthesizer } from "../adapters/synthesizer.js";
import { mountAdminRoutes } from "../admin/routes.js";
import { extractToken } from "./auth.js";
import { CairnError } from "./errors.js";
import { handleQueryCareer } from "../tools/query_career.js";
import { handleListClaims } from "../tools/list_claims.js";
import { handleGetClaim } from "../tools/get_claim.js";
import { readIdentityResource } from "../resources/identity.js";
import { readSchemaResource } from "../resources/schema.js";
import { readServerInfoResource } from "../resources/server_info.js";
import { handleEndorsementStart, handleEndorsementComplete } from "../verification/endorser.js";

const MAX_REQUEST_BYTES = 5 * 1024 * 1024; // §12 — career objects under 5MB.
const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
	{
		name: "query_career",
		description: "Structured request for claims relevant to a stated information need.",
		inputSchema: {
			type: "object",
			properties: {
				information_needed: { type: "string" },
				client: {
					type: "object",
					properties: {
						audience_email: { type: "string" },
						audience_hint: { type: "string" },
						role_context: { type: "string" },
					},
				},
				max_claims: { type: "number" },
			},
			required: ["information_needed"],
		},
	},
	{
		name: "list_claims",
		description: "Structured listing of claims with optional filters.",
		inputSchema: {
			type: "object",
			properties: {
				type: { type: "string" },
				since: { type: "string" },
				limit: { type: "number" },
				cursor: { type: "string" },
			},
		},
	},
	{
		name: "get_claim",
		description: "Retrieve a single claim by id.",
		inputSchema: {
			type: "object",
			properties: { claim_id: { type: "string" } },
			required: ["claim_id"],
		},
	},
];

const RESOURCES = [
	{ uri: "cairn://identity", name: "identity", description: "The subject's identity claim." },
	{ uri: "cairn://schema", name: "schema", description: "Schema version and JSON-LD context." },
	{ uri: "cairn://server_info", name: "server_info", description: "Server metadata, per spec §10.3." },
];

export interface BuildAppDeps {
	subject: string;
	operatorUrl: string;
	operatorType?: "hosted" | "self_hosted" | "experimental";
	db: Database;
	claims: ClaimsRepo;
	tokens: TokensRepo;
	audit: AuditRepo;
	subjects: SubjectRepo;
	adminTokens: AdminTokensRepo;
	evidenceStore: EvidenceStore;
	mailer: Mailer;
	synthesizer: Synthesizer;
	rateLimit: { window_ms: number; max: number };
	corsOrigins: string[];
}

interface AuthState {
	authenticated: boolean;
	token_id: string | null;
	audience_hint?: string;
	purpose?: string;
}

// Simple in-memory token bucket per source (IP for unauth; token_id for auth).
class RateLimiter {
	private buckets = new Map<string, { count: number; reset_at: number }>();
	constructor(private window_ms: number, private max: number) {}

	check(key: string): { ok: boolean; retry_after_seconds: number } {
		const now = Date.now();
		const b = this.buckets.get(key);
		if (!b || b.reset_at <= now) {
			this.buckets.set(key, { count: 1, reset_at: now + this.window_ms });
			return { ok: true, retry_after_seconds: 0 };
		}
		b.count += 1;
		if (b.count > this.max) {
			return { ok: false, retry_after_seconds: Math.ceil((b.reset_at - now) / 1000) };
		}
		return { ok: true, retry_after_seconds: 0 };
	}
}

export function buildApp(depsIn: BuildAppDeps) {
	const deps: BuildAppDeps = { ...depsIn, operatorType: depsIn.operatorType ?? "self_hosted" };
	const limiter = new RateLimiter(deps.rateLimit.window_ms, deps.rateLimit.max);
	const app = new Hono();

	app.use(
		"*",
		cors({
			origin: deps.corsOrigins,
			allowHeaders: ["Authorization", "Content-Type", "Accept"],
			allowMethods: ["GET", "POST", "OPTIONS"],
			credentials: false,
		}),
	);

	app.get("/healthz", (c) => c.text("ok"));

	// Admin API routes (#7). /admin/api/whoami, /admin/api/subject/* — all gated by the
	// admin bearer except completion endpoints (the email challenge is the credential).
	// Phase 5 will migrate /admin/api/endorsement/* into the same module.
	mountAdminRoutes(app, {
		subject: deps.subject,
		operatorUrl: deps.operatorUrl,
		db: deps.db,
		adminTokens: deps.adminTokens,
		subjects: deps.subjects,
		claims: deps.claims,
		mailer: deps.mailer,
		evidenceStore: deps.evidenceStore,
	});

	app.post("/admin/api/endorsement/start", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			endorser_email?: string;
			endorser_name?: string;
			value?: unknown;
		};
		const result = await handleEndorsementStart(deps, body);
		return c.json(result, 202);
	});
	app.get("/admin/api/endorsement/complete", async (c) => {
		const challenge = c.req.query("challenge");
		const discloseLocal = c.req.query("disclose_local") === "1";
		const ok = handleEndorsementComplete(deps, { challenge, discloseLocal });
		return c.json({ ok }, ok ? 200 : 400);
	});

	// MCP transport: POST to /mcp, /mcp?t=, or /mcp/t/<token>
	const mcpHandler = async (c: any) => {
		const raw = await c.req.raw.clone().text();
		if (raw.length > MAX_REQUEST_BYTES) {
			return c.json(
				rpcError(null, new CairnError("malformed_input", "request body exceeds size limit")),
				413,
			);
		}

		const extracted = extractToken(c.req.raw);
		if (extracted.mismatch) {
			return c.json(
				rpcError(null, new CairnError("token_mismatch", "tokens disagree across transport forms")),
				400,
			);
		}

		let payload: any;
		try {
			payload = JSON.parse(raw);
		} catch {
			return c.json(rpcError(null, new CairnError("malformed_input", "invalid JSON")), 200);
		}

		// Resolve auth. Token errors are emitted ONLY for tools/call and identity resource reads
		// (the methods that return claim data). Discovery methods (initialize, tools/list,
		// resources/list, server_info/schema reads) treat invalid tokens as anonymous per §10:
		// capabilities and discovery surface MUST be identical regardless of auth state.
		const authResult = resolveAuth(deps, extracted.token);
		if (authResult instanceof CairnError && isAuthSensitive(payload)) {
			return c.json(rpcError(payload.id ?? null, authResult), 200);
		}
		const auth: AuthState =
			authResult instanceof CairnError ? { authenticated: false, token_id: null } : authResult;

		// Rate limit unauthenticated query_career; per-token for authenticated.
		const rateKey = auth.token_id ?? `anon:${c.req.header("x-forwarded-for") ?? "local"}`;
		if (isRateLimited(payload)) {
			const check = limiter.check(rateKey);
			if (!check.ok) {
				return c.json(
					rpcError(payload?.id ?? null, new CairnError("rate_limited", "rate limit exceeded", {
						retry_after_seconds: check.retry_after_seconds,
					})),
					200,
				);
			}
		}

		try {
			const result = await dispatch(deps, payload, auth);
			return c.json({ jsonrpc: "2.0", id: payload.id ?? null, result }, 200);
		} catch (err) {
			if (err instanceof CairnError) {
				return c.json(rpcError(payload.id ?? null, err), 200);
			}
			// Fall back to malformed_input for unknown errors; better than leaking internals.
			const wrapped = new CairnError("malformed_input", err instanceof Error ? err.message : String(err));
			return c.json(rpcError(payload.id ?? null, wrapped), 200);
		}
	};

	app.post("/mcp", mcpHandler);
	app.post("/mcp/t/:token", mcpHandler);
	app.post("/mcp/t/:token/*", mcpHandler);

	return app;
}

function resolveAuth(deps: BuildAppDeps, token: string | undefined): AuthState | CairnError {
	if (!token) return { authenticated: false, token_id: null };
	const status = deps.tokens.check(token);
	switch (status.kind) {
		case "valid":
			return {
				authenticated: true,
				token_id: status.record.token_id,
				audience_hint: status.record.audience_hint,
				purpose: status.record.purpose,
			};
		case "expired":
			return new CairnError("token_expired", "token has expired");
		case "revoked":
			return new CairnError("token_revoked", "token has been revoked");
		case "invalid":
			return new CairnError("token_invalid", "token is unknown");
	}
}

async function dispatch(deps: BuildAppDeps, payload: any, auth: AuthState): Promise<unknown> {
	const method = payload.method as string;

	if (method === "initialize") {
		return {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: { tools: {}, resources: {} },
			serverInfo: { name: "cairn-server", version: "0.0.0" },
		};
	}
	if (method === "tools/list") {
		return { tools: TOOLS };
	}
	if (method === "resources/list") {
		return { resources: RESOURCES };
	}
	// #7 change-email: the current subject may differ from the config-time `deps.subject`
	// (initial bootstrap value) after a change-email cascade. Honour the dynamic pointer.
	const currentSubject = deps.subjects.getCurrentSubject() ?? deps.subject;

	if (method === "tools/call") {
		// Subject verification gate (§4.1).
		if (!deps.subjects.isVerified(currentSubject)) {
			throw new CairnError("subject_unverified", "subject email not yet verified");
		}
		const { name, arguments: args } = payload.params ?? {};
		return await callTool(deps, name, args, auth, payload.id);
	}
	if (method === "resources/read") {
		// Resources read does NOT require subject verification for server_info / schema
		// (these are bootstrap metadata), but identity DOES.
		const uri = payload.params?.uri as string | undefined;
		if (uri === "cairn://server_info") {
			return readServerInfoResource({ operatorUrl: deps.operatorUrl, operatorType: deps.operatorType! });
		}
		if (uri === "cairn://schema") {
			return readSchemaResource();
		}
		if (uri === "cairn://identity") {
			if (!deps.subjects.isVerified(currentSubject)) {
				throw new CairnError("subject_unverified", "subject email not yet verified");
			}
			return readIdentityResource({ ...deps, subject: currentSubject });
		}
		throw new CairnError("malformed_input", `unknown resource uri: ${uri}`);
	}
	throw new CairnError("malformed_input", `unknown method: ${method}`);
}

async function callTool(
	deps: BuildAppDeps,
	name: string,
	args: any,
	auth: AuthState,
	requestId: string | number,
): Promise<{ content: any[]; structuredContent: unknown; isError?: boolean }> {
	const ctx = { deps, auth, requestId: typeof requestId === "string" ? requestId : String(requestId) };
	switch (name) {
		case "query_career": {
			const out = await handleQueryCareer(ctx, args);
			return wrapResult(out);
		}
		case "list_claims": {
			const out = await handleListClaims(ctx, args);
			return wrapResult(out);
		}
		case "get_claim": {
			const out = await handleGetClaim(ctx, args);
			return wrapResult(out);
		}
		default:
			throw new CairnError("malformed_input", `unknown tool: ${name}`);
	}
}

function wrapResult(out: unknown) {
	return {
		content: [{ type: "text", text: JSON.stringify(out) }],
		structuredContent: out,
	};
}

function isRateLimited(payload: any): boolean {
	return (
		payload?.method === "tools/call" &&
		payload?.params?.name === "query_career"
	);
}

function isAuthSensitive(payload: any): boolean {
	if (payload?.method === "tools/call") return true;
	if (payload?.method === "resources/read") {
		const uri = payload?.params?.uri;
		// identity is the only resource that depends on subject verification + sees subject data.
		// schema and server_info are pure metadata and ignore token state.
		return uri === "cairn://identity";
	}
	return false;
}

function rpcError(id: string | number | null, err: CairnError) {
	return { jsonrpc: "2.0", id, error: err.toRpcError() };
}

export interface ToolContext {
	deps: BuildAppDeps;
	auth: AuthState;
	requestId: string;
}

export function makeRequestId(): string {
	return `req_${randomBytes(8).toString("hex")}`;
}
