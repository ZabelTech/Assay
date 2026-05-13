// Test harness: builds an in-process Hono+MCP server backed by in-memory SQLite,
// with the CaptureMailer and StubSynthesizer wired in. Returns a request() function
// that takes JSON-RPC requests and runs them through the same Hono pipeline real
// clients hit.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
import type { Claim } from "../../src/domain/types.js";
import type { CapturedEmail } from "../../src/adapters/mailer.js";
import { buildApp } from "../../src/mcp/transport.js";
import { CaptureMailer } from "../../src/adapters/mailer.js";
import { StubSynthesizer } from "../../src/adapters/synthesizer.js";
import { MemoryEvidenceStore } from "../../src/adapters/evidence_store.js";
import { MockOAuthProvider, type OAuthProvider } from "../../src/adapters/oauth.js";
import { MockPdfParser } from "../../src/adapters/pdf_parser.js";
import { MockStructurer } from "../../src/adapters/structurer.js";
import { MockWebSearch } from "../../src/adapters/web_search.js";
import { PassThroughVerifier, type Verifier } from "../../src/adapters/verifier.js";
import {
	GithubNormalizer,
	LinkedinNormalizer,
	PasteNormalizer,
	PdfNormalizer,
	type SourceNormalizerRegistry,
} from "../../src/adapters/source_normalizer.js";
import { ClaimDraftsRepo } from "../../src/storage/claim_drafts.repo.js";
import { openDatabase } from "../../src/storage/db.js";
import { AdminTokensRepo } from "../../src/storage/admin_tokens.repo.js";
import { ClaimsRepo } from "../../src/storage/claims.repo.js";
import { TokensRepo } from "../../src/storage/tokens.repo.js";
import { AuditRepo } from "../../src/storage/audit.repo.js";
import { HandlesRepo } from "../../src/storage/handles.repo.js";
import { SubjectRepo } from "../../src/storage/subject.repo.js";
import { PendingWikiProposalsRepo } from "../../src/storage/pending_wiki_proposals.repo.js";
import { ConflictsRepo } from "../../src/storage/conflicts.repo.js";
import { CorpusMetadataRepo } from "../../src/storage/corpus_metadata.repo.js";
import { WikiPageUsesRepo } from "../../src/storage/wiki_page_uses.repo.js";
import { CorpusStore } from "../../src/corpus/store.js";
import { ImportPipeline } from "../../src/pipeline/import_pipeline.js";
import { EmptyWikiReader, type WikiReader } from "../../src/wiki/reader.js";
import { WikiRepo } from "../../src/wiki/repo.js";

export type TokenForm = "header" | "query" | "path";

export interface BuildTestServerOpts {
	subject?: string;
	subjectVerified?: boolean; // default true
	claims?: Claim[];
	operatorUrl?: string;
	operatorType?: "hosted" | "self_hosted" | "experimental";
	rateLimit?: { window_ms: number; max: number };
	// Defaults to PassThroughVerifier so existing #7 tests (which register
	// fixture values that aren't substrings of the raw input) don't trip the
	// #15 SubstringVerifier. New PR C tests that exercise verification
	// semantics override this with `SubstringVerifier`.
	verifier?: Verifier;
	// Defaults to EmptyWikiReader. PR C tests that need the structurer to
	// see real wiki pages substitute `FsWikiReader.load(projectWiki)` or a
	// stub.
	wikiReader?: WikiReader;
}

export interface TestServer {
	subject: string;
	operatorUrl: string;
	mailer: CaptureMailer;
	claims: ClaimsRepo;
	tokens: TokensRepo;
	audit: AuditRepo;
	subjects: SubjectRepo;
	adminTokens: AdminTokensRepo;
	drafts: ClaimDraftsRepo;
	structurer: MockStructurer;
	web: MockWebSearch;
	oauthProviders: Map<string, OAuthProvider>;
	pdfParser: MockPdfParser;
	wikiProposals: PendingWikiProposalsRepo;
	wikiRepo: WikiRepo;
	wikiRepoDir: string;
	conflicts: ConflictsRepo;
	corpusMetadata: CorpusMetadataRepo;
	corpusStore: CorpusStore;
	corpusDir: string;
	pipeline: ImportPipeline;
	evidenceStore: MemoryEvidenceStore;
	adminToken: string;
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
	adminFetch(path: string, init?: RequestInit & { noAuth?: boolean }): Promise<Response>;
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
	const adminTokens = new AdminTokensRepo(db);
	const handles = new HandlesRepo(db);
	const drafts = new ClaimDraftsRepo(db);
	const evidenceStore = new MemoryEvidenceStore();
	const structurer = new MockStructurer();
	const pdfParser = new MockPdfParser();
	const oauthProviders = new Map<string, OAuthProvider>([
		["linkedin", new MockOAuthProvider("linkedin")],
		["github", new MockOAuthProvider("github")],
	]);
	const mailer = new CaptureMailer();
	const synthesizer = new StubSynthesizer();
	const wikiProposals = new PendingWikiProposalsRepo(db);
	const conflictsRepo = new ConflictsRepo(db);
	const corpusMetadata = new CorpusMetadataRepo(db);
	const wikiPageUses = new WikiPageUsesRepo(db);
	const corpusDir = mkdtempSync(join(tmpdir(), "assay-corpus-"));
	const corpusStore = new CorpusStore(corpusDir);
	const web = new MockWebSearch();
	const verifier = opts.verifier ?? new PassThroughVerifier();
	const wikiReader = opts.wikiReader ?? new EmptyWikiReader();
	const normalizers: SourceNormalizerRegistry = {
		paste: new PasteNormalizer(),
		pdf: new PdfNormalizer(pdfParser),
		linkedin: new LinkedinNormalizer(),
		github: new GithubNormalizer(),
	};
	const pipeline = new ImportPipeline({
		db,
		corpusStore,
		corpusMetadata,
		evidenceStore,
		claims,
		drafts,
		conflicts: conflictsRepo,
		wikiProposals,
		wikiPageUses,
		wikiReader,
		web,
		normalizers,
		structurer,
		verifier,
	});
	// Each test gets an isolated tmpdir for the wiki repo. Cleanup happens in
	// close(). Tests that actually exercise promote() must call
	// `await ts.wikiRepo.initIfMissing()` first; the constructor is cheap so
	// tests that don't touch wiki proposals pay nothing.
	const wikiRepoDir = mkdtempSync(join(tmpdir(), "assay-wiki-repo-"));
	// Absolute paths — the pre-commit hook runs from the wiki repo's cwd, not
	// project root, so relative resolution won't find tsx or the CLI source.
	const projectRoot = resolve(HERE, "..", "..", "..");
	const tsxBin = resolve(projectRoot, "node_modules", ".bin", "tsx");
	const linterCliPath = resolve(projectRoot, "server", "src", "wiki", "page_lint_cli.ts");
	const wikiRepo = new WikiRepo({
		repoDir: wikiRepoDir,
		seedDir: resolve(projectRoot, "wiki"),
		// In tests we invoke the linter via tsx against the TS source so we don't
		// need a build step. Production passes `node <dist-cli>` here.
		linterCommand: `${tsxBin} ${linterCliPath}`,
	});

	const { token: adminToken } = adminTokens.issue();

	// Seed the subject row + current_subject pointer so the dynamic-subject MCP gate works
	// from the start. seedSubject is idempotent and does not flip verification state.
	subjects.seedSubject(subject);

	if (opts.subjectVerified ?? true) {
		subjects.markVerified(subject, { challenge_method: "click_through_link" });
	}

	for (const claim of opts.claims ?? []) {
		claims.insert(claim);
	}

	const app = buildApp({
		subject,
		operatorUrl,
		operatorType: opts.operatorType,
		db,
		claims,
		tokens,
		audit,
		subjects,
		adminTokens,
		handles,
		drafts,
		evidenceStore,
		mailer,
		synthesizer,
		structurer,
		oauthProviders,
		pdfParser,
		wikiProposals,
		wikiRepo,
		conflicts: conflictsRepo,
		pipeline,
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
		adminTokens,
		drafts,
		structurer,
		web,
		oauthProviders,
		pdfParser,
		wikiProposals,
		wikiRepo,
		wikiRepoDir,
		conflicts: conflictsRepo,
		corpusMetadata,
		corpusStore,
		corpusDir,
		pipeline,
		evidenceStore,
		adminToken,
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
		async rawFetch(path, init) {
			return app.fetch(new Request(`http://localhost${path}`, init));
		},
		async adminFetch(path, init = {}) {
			const { noAuth, headers, ...rest } = init as RequestInit & { noAuth?: boolean };
			const merged = new Headers(headers);
			if (!noAuth && !merged.has("authorization")) {
				merged.set("authorization", `Bearer ${adminToken}`);
			}
			return app.fetch(new Request(`http://localhost${path}`, { ...rest, headers: merged }));
		},
		outbox() {
			return mailer.outbox();
		},
		close() {
			db.close();
			rmSync(wikiRepoDir, { recursive: true, force: true });
			rmSync(corpusDir, { recursive: true, force: true });
		},
	};
}
