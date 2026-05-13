// Minimal admin CLI. `cairn token issue|revoke`, `cairn claim add`, `cairn subject verify`,
// `cairn admin bootstrap`. Talks to the same SQLite file the server uses. Out-of-protocol.
import { readFileSync } from "node:fs";
import type { Database } from "better-sqlite3";
import { loadConfig, type Config } from "../config.js";
import { openDatabase } from "../storage/db.js";
import { ClaimsRepo } from "../storage/claims.repo.js";
import { TokensRepo } from "../storage/tokens.repo.js";
import { SubjectRepo } from "../storage/subject.repo.js";
import { AdminTokensRepo } from "../storage/admin_tokens.repo.js";
import { parseClaim } from "../domain/validators.js";

export interface CliIO {
	stdout(line: string): void;
	stderr(line: string): void;
	exit(code: number): never;
}

const defaultIO: CliIO = {
	stdout(line) {
		console.log(line);
	},
	stderr(line) {
		console.error(line);
	},
	exit(code) {
		process.exit(code);
	},
};

export interface CliDeps {
	db: Database;
	config: Config;
	io: CliIO;
}

export function runCli(argv: string[], depsIn?: Partial<CliDeps>): void {
	const config = depsIn?.config ?? loadConfig();
	const db = depsIn?.db ?? openDatabase(config.dbPath);
	const io = depsIn?.io ?? defaultIO;

	const claims = new ClaimsRepo(db);
	const tokens = new TokensRepo(db);
	const subjects = new SubjectRepo(db);
	const adminTokens = new AdminTokensRepo(db);

	const [verb, noun, ...rest] = argv;

	function usage(): never {
		io.stderr(`usage:
  cairn token issue [--days N] [--audience HINT] [--purpose TEXT]
  cairn token revoke <token_id>
  cairn claim add <path/to/claim.json>
  cairn subject verify <email>
  cairn admin bootstrap [--subject <email>]`);
		io.exit(1);
		throw new Error("unreachable"); // TS control-flow guard; io.exit is `never` but TS doesn't widen via method call.
	}

	if (verb === "token" && noun === "issue") {
		const args = parseArgs(rest);
		const days = Number(args.days ?? "90");
		const { token, token_id } = tokens.issue({
			expires_at: new Date(Date.now() + days * 86400000).toISOString(),
			audience_hint: args.audience,
			purpose: args.purpose,
		});
		io.stdout(`token_id: ${token_id}`);
		io.stdout(`url: ${config.operatorUrl}/mcp?t=${token}`);
	} else if (verb === "token" && noun === "revoke") {
		if (!rest[0]) usage();
		tokens.revoke(rest[0]);
		io.stdout(`revoked ${rest[0]}`);
	} else if (verb === "claim" && noun === "add") {
		if (!rest[0]) usage();
		const raw = readFileSync(rest[0], "utf8");
		const parsed = parseClaim(JSON.parse(raw));
		claims.insert(parsed);
		io.stdout(`added ${parsed.claim_id}`);
	} else if (verb === "subject" && noun === "verify") {
		if (!rest[0]) usage();
		subjects.markVerified(rest[0], { challenge_method: "manual_cli" });
		io.stdout(`marked ${rest[0]} verified`);
	} else if (verb === "admin" && noun === "bootstrap") {
		// #7 admin bootstrap: provision the initial admin bearer token and (optionally) seed
		// the subject record. The subject's email is set by an admin out-of-band per #7;
		// this CLI is the canonical self-hosted path for that bootstrap step.
		// The token is printed once and never persisted in plaintext (only its SHA-256 hash).
		const args = parseArgs(rest);
		if (args.subject) {
			subjects.seedSubject(args.subject);
			io.stdout(`subject: ${args.subject}`);
		}
		const { token } = adminTokens.issue();
		io.stdout(`admin_token: ${token}`);
		io.stdout(`(shown once — store it now; the server keeps only a SHA-256 hash)`);
	} else {
		usage();
	}
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

// Allow direct invocation as a script (preserves the pre-existing CLI entry behaviour).
if (import.meta.url === `file://${process.argv[1]}`) {
	runCli(process.argv.slice(2));
}
