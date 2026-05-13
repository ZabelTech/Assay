// #17 WikiRepo. Init seeds the local git repo from the project's wiki/ dir;
// promote() stages a page and commits via local git, with the wiki linter
// running as a pre-commit hook (per #16) — non-conforming proposals are
// rejected before the commit lands.
//
// These tests use real git (we shell out via execFile) and the real linter
// (invoked through tsx by the test-mode linterCommand wired in the test
// helper). Each test gets a fresh tmpdir.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WikiPromoteError, WikiRepo } from "../../../src/wiki/repo.js";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..", "..", "..");
const SEED_DIR = resolve(PROJECT_ROOT, "wiki");
const TSX_BIN = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const LINTER_CLI = resolve(PROJECT_ROOT, "server/src/wiki/page_lint_cli.ts");
const LINTER_CMD = `${TSX_BIN} ${LINTER_CLI}`;

let repoDir: string;
let repo: WikiRepo;

beforeEach(async () => {
	repoDir = await mkdtemp(join(tmpdir(), "wiki-repo-test-"));
	repo = new WikiRepo({ repoDir, seedDir: SEED_DIR, linterCommand: LINTER_CMD });
});
afterEach(async () => {
	await rm(repoDir, { recursive: true, force: true });
});

const CONFORMING_PAGE = `---
kind: skill
slug: rust
updated_at: 2026-05-01
sources:
  - https://example.com/rust-survey
related: []
---

## Signal

> sources: 1

- Memory safety without GC is the headline value prop.
- Used in systems programming, embedded, and increasingly in backend services.
`;

const NON_CONFORMING_PAGE = `---
kind: skill
slug: rust
updated_at: 2026-05-01
sources:
  - https://example.com/rust-survey
related: []
---

## Signal

This section has no \`> sources:\` declaration — the linter must reject it.
`;

describe("WikiRepo", () => {
	// WHY: first-boot must produce a usable git repo seeded with the bundled
	// pages. Re-running initIfMissing must be a no-op (idempotent) so server
	// restarts don't churn the repo.
	it("initIfMissing seeds from the project wiki on first call, and is idempotent on second", async () => {
		await repo.initIfMissing();
		expect(existsSync(join(repoDir, ".git"))).toBe(true);
		expect(existsSync(join(repoDir, "roles/staff-platform-engineer.md"))).toBe(true);
		expect(existsSync(join(repoDir, ".git/hooks/pre-commit"))).toBe(true);

		const { stdout: firstHead } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: repoDir });
		await repo.initIfMissing(); // second call — must not change history
		const { stdout: secondHead } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: repoDir });
		expect(secondHead).toBe(firstHead);
	});

	// WHY: a clean promote of a conforming page must land a commit and place the
	// file in the right kind directory. The commit_sha returned must be the
	// repo's new HEAD.
	it("promote commits a conforming page and the file ends up at the right path", async () => {
		await repo.initIfMissing();
		const result = await repo.promote({ kind: "skill", slug: "rust", markdown: CONFORMING_PAGE });

		expect(result.relative_path).toBe("skills/rust.md");
		const onDisk = await readFile(join(repoDir, result.relative_path), "utf8");
		expect(onDisk).toContain("## Signal");

		const { stdout: head } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: repoDir });
		expect(head.trim()).toBe(result.commit_sha);
	});

	// WHY: the pre-commit hook is the load-bearing check in the #17 spec — pins
	// "the wiki linter runs as a pre-commit hook and rejects non-conforming
	// drafts before the commit lands". The test deliberately submits a page
	// missing the per-section sources blockquote and asserts (a) the promote
	// rejects with stage="lint", (b) the repo's HEAD didn't advance, (c) the
	// file isn't left lying around on disk.
	it("pre-commit hook rejects a non-conforming proposal and leaves the repo untouched", async () => {
		await repo.initIfMissing();
		const { stdout: beforeHead } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: repoDir });

		await expect(
			repo.promote({ kind: "skill", slug: "rust", markdown: NON_CONFORMING_PAGE }),
		).rejects.toBeInstanceOf(WikiPromoteError);

		const { stdout: afterHead } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: repoDir });
		expect(afterHead).toBe(beforeHead);
		expect(existsSync(join(repoDir, "skills/rust.md"))).toBe(false);
	});

	// WHY: hasPage is used by the #15 gap-filling path to avoid re-proposing
	// pages that already exist. Pins that seeded pages are discoverable by slug.
	it("hasPage returns true for a seeded page and false for an unknown slug", async () => {
		await repo.initIfMissing();
		expect(await repo.hasPage("staff-platform-engineer")).toBe(true);
		expect(await repo.hasPage("does-not-exist")).toBe(false);
	});
});
