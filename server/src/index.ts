// Entrypoint: load config, wire dependencies, start Hono on @hono/node-server.
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { CaptureMailer, SmtpMailer } from "./adapters/mailer.js";
import { LocalEvidenceStore } from "./adapters/evidence_store.js";
import { StubSynthesizer } from "./adapters/synthesizer.js";
import { openDatabase } from "./storage/db.js";
import { AdminTokensRepo } from "./storage/admin_tokens.repo.js";
import { ClaimsRepo } from "./storage/claims.repo.js";
import { TokensRepo } from "./storage/tokens.repo.js";
import { AuditRepo } from "./storage/audit.repo.js";
import { HandlesRepo } from "./storage/handles.repo.js";
import { SubjectRepo } from "./storage/subject.repo.js";
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

const app = buildApp({
	subject: cfg.subject,
	operatorUrl: cfg.operatorUrl,
	operatorType: cfg.operatorType,
	db,
	claims: new ClaimsRepo(db),
	tokens: new TokensRepo(db),
	audit: new AuditRepo(db),
	subjects: new SubjectRepo(db),
	adminTokens: new AdminTokensRepo(db),
	handles: new HandlesRepo(db),
	evidenceStore: new LocalEvidenceStore(cfg.evidenceDir),
	mailer,
	synthesizer: new StubSynthesizer(),
	rateLimit: cfg.rateLimit,
	corsOrigins: cfg.corsOrigins,
});

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
	console.log(`Cairn server listening on http://localhost:${info.port}`);
});
