// Test harness: builds an in-process Hono+MCP server backed by in-memory SQLite,
// with the CaptureMailer and StubSynthesizer wired in. Returns a request() function
// that takes JSON-RPC requests and runs them through the same Hono pipeline real
// clients hit.

import type { Claim } from "../../src/domain/types.js";
import type { CapturedEmail } from "../../src/adapters/mailer.js";
import { buildApp } from "../../src/mcp/transport.js";
import { CaptureMailer } from "../../src/adapters/mailer.js";
import { StubSynthesizer } from "../../src/adapters/synthesizer.js";
import { openDatabase } from "../../src/storage/db.js";
import { ClaimsRepo } from "../../src/storage/claims.repo.js";
import { TokensRepo } from "../../src/storage/tokens.repo.js";
import { AuditRepo } from "../../src/storage/audit.repo.js";
import { SubjectRepo } from "../../src/storage/subject.repo.js";

export type TokenForm = "header" | "query" | "path";

export interface BuildTestServerOpts {
	subject?: string;
	subjectVerified?: boolean; // default true
	claims?: Claim[];
	operatorUrl?: string;
	rateLimit?: { window_ms: number; max: number };
}

export interface TestServer {
	subject: string;
	operatorUrl: string;
	mailer: CaptureMailer;
	claims: ClaimsRepo;
	tokens: TokensRepo;
	audit: AuditRepo;
	subjects: SubjectRepo;
	issueToken(opts?: {
		expires_at?: string;
		audience_hint?: string;
		purpose?: string;
		revoked?: boolean;
	}): { token: string; token_id: string };
	request(opts: {
		method: string;
		params?: unknown;
		id?: number | string;
		token?: string;
		tokenForm?: TokenForm;
		extraHeaders?: Record<string, string>;
		extraQuery?: Record<string, string>;
	}): Promise<{ status: number; body: any; headers: Record<string, string> }>;
	rawFetch(path: string, init?: RequestInit): Promise<Response>;
	outbox(): CapturedEmail[];
	close(): void;
}

export async function buildTestServer(opts: BuildTestServerOpts = {}): Promise<TestServer> {
	const subject = opts.subject ?? "alice@example.com";
	const operatorUrl = opts.operatorUrl ?? "https://test.invalid";

	const db = openDatabase(":memory:");
	const claims = new ClaimsRepo(db);
	const tokens = new TokensRepo(db);
	const audit = new AuditRepo(db);
	const subjects = new SubjectRepo(db);
	const mailer = new CaptureMailer();
	const synthesizer = new StubSynthesizer();

	if (opts.subjectVerified ?? true) {
		subjects.markVerified(subject, { challenge_method: "click_through_link" });
	}

	for (const claim of opts.claims ?? []) {
		claims.insert(claim);
	}

	const app = buildApp({
		subject,
		operatorUrl,
		claims,
		tokens,
		audit,
		subjects,
		mailer,
		synthesizer,
		rateLimit: opts.rateLimit ?? { window_ms: 60_000, max: 60 },
		corsOrigins: ["*"],
	});

	function buildUrl(token: string | undefined, form: TokenForm, extraQuery?: Record<string, string>) {
		const url = new URL("http://localhost/mcp");
		if (token && form === "query") url.searchParams.set("t", token);
		if (extraQuery) {
			for (const [k, v] of Object.entries(extraQuery)) url.searchParams.set(k, v);
		}
		if (token && form === "path") {
			url.pathname = `/mcp/t/${token}`;
		}
		return url.toString();
	}

	return {
		subject,
		operatorUrl,
		mailer,
		claims,
		tokens,
		audit,
		subjects,
		issueToken(o = {}) {
			return tokens.issue({
				expires_at: o.expires_at ?? new Date(Date.now() + 86400000).toISOString(),
				audience_hint: o.audience_hint,
				purpose: o.purpose,
				revoked: o.revoked ?? false,
			});
		},
		async request(req) {
			const form: TokenForm = req.tokenForm ?? "header";
			const url = buildUrl(req.token, form, req.extraQuery);
			const headers: Record<string, string> = {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...(req.extraHeaders ?? {}),
			};
			if (req.token && form === "header") {
				headers.authorization = `Bearer ${req.token}`;
			}
			const body = JSON.stringify({
				jsonrpc: "2.0",
				id: req.id ?? 1,
				method: req.method,
				params: req.params,
			});
			const res = await app.fetch(new Request(url, { method: "POST", headers, body }));
			const text = await res.text();
			let parsed: any;
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
			// For tools/call, MCP wraps tool output in { content, structuredContent }.
			// Unwrap structuredContent into `result` so tests can read result.claims directly.
			if (req.method === "tools/call" && parsed?.result?.structuredContent) {
				parsed.result = parsed.result.structuredContent;
			}
			const outHeaders: Record<string, string> = {};
			res.headers.forEach((v, k) => {
				outHeaders[k] = v;
			});
			return { status: res.status, body: parsed, headers: outHeaders };
		},
		rawFetch(path, init) {
			return app.fetch(new Request(`http://localhost${path}`, init));
		},
		outbox() {
			return mailer.outbox();
		},
		close() {
			db.close();
		},
	};
}
