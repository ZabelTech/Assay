// #7 `cairn admin bootstrap` — provisions the initial admin bearer token and seeds the subject.
// Acceptance: token printed once, hashed at rest, subject seeded but not auto-verified.
import { describe, expect, it } from "vitest";
import { runCli, type CliIO } from "../../../src/cli/index.js";
import { openDatabase } from "../../../src/storage/db.js";
import { AdminTokensRepo } from "../../../src/storage/admin_tokens.repo.js";
import { SubjectRepo } from "../../../src/storage/subject.repo.js";

function makeIO() {
	const stdout: string[] = [];
	const stderr: string[] = [];
	let exitCode: number | undefined;
	const io: CliIO = {
		stdout: (l) => stdout.push(l),
		stderr: (l) => stderr.push(l),
		exit: (c) => {
			exitCode = c;
			throw new Error(`__exit_${c}__`);
		},
	};
	return { io, stdout, stderr, getExit: () => exitCode };
}

describe("#7 cairn admin bootstrap", () => {
	it("issues an admin token and prints it once", () => {
		const db = openDatabase(":memory:");
		const { io, stdout } = makeIO();
		runCli(["admin", "bootstrap"], { db, io, config: { operatorUrl: "x", dbPath: ":memory:" } as never });

		const tokenLine = stdout.find((l) => l.startsWith("admin_token: "));
		expect(tokenLine).toBeDefined();
		const token = tokenLine!.slice("admin_token: ".length);
		expect(token.length).toBeGreaterThanOrEqual(22);

		// Token is valid against the repo
		const repo = new AdminTokensRepo(db);
		expect(repo.check(token)).toBe("valid");

		// SHA-256 hash stored, not the token itself
		const rows = db.prepare(`SELECT token_hash FROM admin_tokens`).all() as { token_hash: string }[];
		expect(rows[0]!.token_hash).not.toBe(token);
	});

	it("seeds the subject email when --subject is provided", () => {
		const db = openDatabase(":memory:");
		const { io, stdout } = makeIO();
		runCli(["admin", "bootstrap", "--subject", "alice@example.com"], {
			db,
			io,
			config: { operatorUrl: "x", dbPath: ":memory:" } as never,
		});

		expect(stdout).toContain("subject: alice@example.com");

		const subjects = new SubjectRepo(db);
		// Subject row exists but is not verified — verification is its own flow (#4.1).
		expect(subjects.isVerified("alice@example.com")).toBe(false);
		const row = db.prepare(`SELECT email FROM subjects WHERE email = ?`).get("alice@example.com");
		expect(row).toBeDefined();
	});

	it("seedSubject is idempotent and never re-verifies", () => {
		// WHY: a second bootstrap (e.g. operator re-running the command) MUST NOT
		// downgrade verification or stomp on existing state.
		const db = openDatabase(":memory:");
		const subjects = new SubjectRepo(db);
		subjects.seedSubject("alice@example.com");
		subjects.markVerified("alice@example.com", { challenge_method: "click_through_link" });
		expect(subjects.isVerified("alice@example.com")).toBe(true);

		subjects.seedSubject("alice@example.com");
		expect(subjects.isVerified("alice@example.com")).toBe(true);
	});

	it("each bootstrap call issues a distinct token (no collision)", () => {
		const db = openDatabase(":memory:");
		const seen = new Set<string>();
		for (let i = 0; i < 5; i++) {
			const { io, stdout } = makeIO();
			runCli(["admin", "bootstrap"], { db, io, config: { operatorUrl: "x", dbPath: ":memory:" } as never });
			const t = stdout.find((l) => l.startsWith("admin_token: "))!.slice("admin_token: ".length);
			expect(seen.has(t)).toBe(false);
			seen.add(t);
		}
	});
});
