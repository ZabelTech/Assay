// Entrypoint: load config, wire dependencies, start Hono on @hono/node-server.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { CaptureMailer, SmtpMailer } from "./adapters/mailer.js";
import { LocalEvidenceStore } from "./adapters/evidence_store.js";
import { MockOAuthProvider } from "./adapters/oauth.js";
import { MockPdfParser } from "./adapters/pdf_parser.js";
import { MockStructurer } from "./adapters/structurer.js";
import { MockWebSearch } from "./adapters/web_search.js";
import { selectVerifier } from "./adapters/verifier.js";
import {
	GithubNormalizer,
	LinkedinNormalizer,
	PasteNormalizer,
	PdfNormalizer,
	UrlSnapshotNormalizer,
	type SourceNormalizerRegistry,
} from "./adapters/source_normalizer.js";
import { StubSynthesizer } from "./adapters/synthesizer.js";
import { ClaimDraftsRepo } from "./storage/claim_drafts.repo.js";
import { openDatabase } from "./storage/db.js";
import { AdminTokensRepo } from "./storage/admin_tokens.repo.js";
import { ClaimsRepo } from "./storage/claims.repo.js";
import { TokensRepo } from "./storage/tokens.repo.js";
import { AuditRepo } from "./storage/audit.repo.js";
import { HandlesRepo } from "./storage/handles.repo.js";
import { SubjectRepo } from "./storage/subject.repo.js";
import { PendingWikiProposalsRepo } from "./storage/pending_wiki_proposals.repo.js";
import { CorpusMetadataRepo } from "./storage/corpus_metadata.repo.js";
import { ConflictsRepo } from "./storage/conflicts.repo.js";
import { WikiPageUsesRepo } from "./storage/wiki_page_uses.repo.js";
import { CorpusStore } from "./corpus/store.js";
import { ImportPipeline } from "./pipeline/import_pipeline.js";
import { FsWikiReader, EmptyWikiReader, type WikiReader } from "./wiki/reader.js";
import { WikiRepo } from "./wiki/repo.js";
import { buildApp } from "./mcp/transport.js";

const cfg = loadConfig();

if (!cfg.subject) {
	console.error("SUBJECT env var is required. Set it to the candidate's email address.");
	process.exit(1);
}

const db = openDatabase(cfg.dbPath);

const mailer =
	cfg.mailer === "smtp"
		? new SmtpMailer({
				host: cfg.smtp.host ?? "localhost",
				port: cfg.smtp.port ?? 25,
				secure: cfg.smtp.secure,
				user: cfg.smtp.user,
				pass: cfg.smtp.pass,
				from: cfg.smtp.from ?? `no-reply@${new URL(cfg.operatorUrl).host}`,
			})
		: new CaptureMailer();

// Resolve the bundled wiki linter CLI path. In the Dockerfile prod layout the
// CLI sits at server/dist/wiki/page_lint_cli.js next to this entrypoint. The
// pre-commit hook script invokes `node <path> <repoDir>`.
const HERE = dirname(fileURLToPath(import.meta.url));
const linterCliJs = resolve(HERE, "wiki/page_lint_cli.js");
const wikiRepo = new WikiRepo({
	repoDir: cfg.wikiRepoDir,
	seedDir: cfg.wikiSeedDir,
	linterCommand: `node ${linterCliJs}`,
	authorEmail: cfg.subject,
});
await wikiRepo.initIfMissing();

// #15 / #16 wiki reader — loads pages from the local wiki repo (seeded from
// the bundled wiki/ on first boot via WikiRepo.initIfMissing).
let wikiReader: WikiReader;
try {
	wikiReader = await FsWikiReader.load(cfg.wikiRepoDir);
} catch {
	wikiReader = new EmptyWikiReader();
}

const claims = new ClaimsRepo(db);
const drafts = new ClaimDraftsRepo(db);
const conflictsRepo = new ConflictsRepo(db);
const wikiProposals = new PendingWikiProposalsRepo(db);
const wikiPageUses = new WikiPageUsesRepo(db);
const corpusMetadata = new CorpusMetadataRepo(db);
const corpusStore = new CorpusStore(cfg.corpusDir);
const evidenceStore = new LocalEvidenceStore(cfg.evidenceDir);
const pdfParser = new MockPdfParser();
const structurer = new MockStructurer();
const web = new MockWebSearch();
const verifier = selectVerifier(process.env);

const normalizers: SourceNormalizerRegistry = {
	paste: new PasteNormalizer(),
	pdf: new PdfNormalizer(pdfParser),
	linkedin: new LinkedinNormalizer(),
	github: new GithubNormalizer(),
	"url-snapshot": new UrlSnapshotNormalizer(),
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

const app = buildApp({
	subject: cfg.subject,
	operatorUrl: cfg.operatorUrl,
	operatorType: cfg.operatorType,
	db,
	claims,
	tokens: new TokensRepo(db),
	audit: new AuditRepo(db),
	subjects: new SubjectRepo(db),
	adminTokens: new AdminTokensRepo(db),
	handles: new HandlesRepo(db),
	drafts,
	evidenceStore,
	wikiProposals,
	wikiRepo,
	conflicts: conflictsRepo,
	pipeline,
	structurer,
	pdfParser,
	oauthProviders: new Map([
		["linkedin", new MockOAuthProvider("linkedin")],
		["github", new MockOAuthProvider("github")],
	]),
	mailer,
	synthesizer: new StubSynthesizer(),
	rateLimit: cfg.rateLimit,
	corsOrigins: cfg.corsOrigins,
});

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
	console.log(`Cairn server listening on http://localhost:${info.port}`);
});
