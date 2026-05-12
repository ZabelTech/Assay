// Minimal admin CLI. `cairn token issue|revoke`, `cairn claim add`, `cairn subject verify`.
// Talks to the same SQLite file the server uses. Out-of-protocol, for hosting-interface ergonomics.
import { readFileSync } from "node:fs";
import { loadConfig } from "../config.js";
import { openDatabase } from "../storage/db.js";
import { ClaimsRepo } from "../storage/claims.repo.js";
import { TokensRepo } from "../storage/tokens.repo.js";
import { SubjectRepo } from "../storage/subject.repo.js";
import { parseClaim } from "../domain/validators.js";

const cfg = loadConfig();
const db = openDatabase(cfg.dbPath);
const claims = new ClaimsRepo(db);
const tokens = new TokensRepo(db);
const subjects = new SubjectRepo(db);

const [verb, noun, ...rest] = process.argv.slice(2);

function usage(): never {
	console.error(`usage:
  cairn token issue [--days N] [--audience HINT] [--purpose TEXT]
  cairn token revoke <token_id>
  cairn claim add <path/to/claim.json>
  cairn subject verify <email>`);
	process.exit(1);
}

if (verb === "token" && noun === "issue") {
	const args = parseArgs(rest);
	const days = Number(args.days ?? "90");
	const { token, token_id } = tokens.issue({
		expires_at: new Date(Date.now() + days * 86400000).toISOString(),
		audience_hint: args.audience,
		purpose: args.purpose,
	});
	console.log(`token_id: ${token_id}`);
	console.log(`url: ${cfg.operatorUrl}/mcp?t=${token}`);
} else if (verb === "token" && noun === "revoke") {
	if (!rest[0]) usage();
	tokens.revoke(rest[0]);
	console.log(`revoked ${rest[0]}`);
} else if (verb === "claim" && noun === "add") {
	if (!rest[0]) usage();
	const raw = readFileSync(rest[0], "utf8");
	const parsed = parseClaim(JSON.parse(raw));
	claims.insert(parsed);
	console.log(`added ${parsed.claim_id}`);
} else if (verb === "subject" && noun === "verify") {
	if (!rest[0]) usage();
	subjects.markVerified(rest[0], { challenge_method: "manual_cli" });
	console.log(`marked ${rest[0]} verified`);
} else {
	usage();
}

function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a.startsWith("--")) {
			const key = a.slice(2);
			out[key] = argv[i + 1] ?? "";
			i++;
		}
	}
	return out;
}
