// #16 wiki linter. One test per failure mode in the issue's acceptance list, plus a
// split-page fixture. Tests build small wiki/ trees in tmpdirs and assert on errors +
// warnings shape — they MUST not depend on the real wiki/ corpus checked into the repo
// (separation of concerns: this file covers the linter, not the seed pages).
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintWiki } from "../../../src/wiki/page_lint.js";

interface FakePage {
	kind: "role" | "skill" | "industry";
	slug: string;
	frontmatter?: string;
	body?: string;
}

const FRESH_DATE = "2026-05-01";

async function writeWiki(root: string, pages: FakePage[]): Promise<void> {
	for (const kind of ["roles", "skills", "industries"]) {
		await mkdir(join(root, kind), { recursive: true });
	}
	for (const p of pages) {
		const dir = p.kind === "role" ? "roles" : p.kind === "skill" ? "skills" : "industries";
		const body = p.body ?? "";
		const frontmatter =
			p.frontmatter ??
			[
				"---",
				`kind: ${p.kind}`,
				`slug: ${p.slug}`,
				`updated_at: ${FRESH_DATE}`,
				"sources:",
				"  - https://example.com/one",
				"  - https://example.com/two",
				"related: []",
				"---",
			].join("\n");
		await writeFile(join(root, dir, `${p.slug}.md`), `${frontmatter}\n${body}`);
	}
}

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "wiki-lint-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("wiki linter — happy path", () => {
	// WHY: a minimal conforming page should produce zero errors and zero warnings. If
	// it doesn't, the linter is too strict and authors will be stuck.
	it("accepts a minimal conforming page", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "ok-page",
				body: "## Signal\n\n> sources: 1\n\n- bullet\n",
			},
		]);
		const { errors, warnings } = await lintWiki(dir);
		expect(errors).toEqual([]);
		expect(warnings).toEqual([]);
	});
});

describe("wiki linter — frontmatter failure modes", () => {
	// WHY: missing-frontmatter is the most common authoring mistake; the error must
	// name it directly so the author knows what to fix.
	it("rejects a file with no frontmatter block", async () => {
		await writeWiki(dir, [
			{ kind: "role", slug: "no-fm", frontmatter: "", body: "## Signal\n\n> sources: 1\n\n- x\n" },
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("missing or malformed YAML frontmatter") }),
		);
	});

	// WHY: kind drives directory and consumer behavior; an unknown kind must fail loudly,
	// not silently pass through as a free-form string.
	it("rejects an invalid kind", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "bad-kind",
				frontmatter: [
					"---",
					"kind: technology",
					"slug: bad-kind",
					`updated_at: ${FRESH_DATE}`,
					"sources:",
					"  - https://example.com/one",
					"related: []",
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("frontmatter.kind must be one of") }),
		);
	});

	// WHY: filename ↔ slug mismatch silently breaks `related` cross-links (the slug is the
	// stable handle). Detecting it at lint time avoids a class of "page exists but I can't
	// link to it" bugs.
	it("rejects slug that doesn't match filename", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "actual-filename",
				frontmatter: [
					"---",
					"kind: role",
					"slug: different-slug",
					`updated_at: ${FRESH_DATE}`,
					"sources:",
					"  - https://example.com/one",
					"related: []",
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("does not match filename slug") }),
		);
	});

	// WHY: updated_at drives the freshness signal; a malformed date undermines staleness
	// detection entirely.
	it("rejects malformed updated_at", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "bad-date",
				frontmatter: [
					"---",
					"kind: role",
					"slug: bad-date",
					"updated_at: 2026/05/01",
					"sources:",
					"  - https://example.com/one",
					"related: []",
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("updated_at must be an ISO date") }),
		);
	});

	// WHY: an empty sources list lets a page pass without citations — the no-vibes rule
	// requires at least one citation.
	it("rejects empty sources list", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "no-sources",
				frontmatter: [
					"---",
					"kind: role",
					"slug: no-sources",
					`updated_at: ${FRESH_DATE}`,
					"sources: []",
					"related: []",
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("must contain at least one URL") }),
		);
	});
});

describe("wiki linter — related cross-link integrity", () => {
	// WHY: a related slug that points nowhere creates a broken graph; the linter is the
	// only place that catches it before the structurer reads the wiki and confuses itself.
	it("rejects a related slug that does not resolve to any page", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "page-a",
				frontmatter: [
					"---",
					"kind: role",
					"slug: page-a",
					`updated_at: ${FRESH_DATE}`,
					"sources:",
					"  - https://example.com/one",
					"related:",
					"  - this-does-not-exist",
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({
				message: expect.stringContaining(`related slug "this-does-not-exist" does not resolve`),
			}),
		);
	});

	// WHY: self-reference in `related` is almost always a typo and produces a confusing
	// adjacency graph. Catching it cheaply avoids debugging time later.
	it("rejects a page that references its own slug", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "self-ref",
				frontmatter: [
					"---",
					"kind: role",
					"slug: self-ref",
					`updated_at: ${FRESH_DATE}`,
					"sources:",
					"  - https://example.com/one",
					"related:",
					"  - self-ref",
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("refers to the page's own slug") }),
		);
	});
});

describe("wiki linter — per-section sources rule", () => {
	// WHY: missing `> sources:` is the per-section rule's whole point — a section that
	// asserts something without a citation is precisely what the rule blocks.
	it("rejects a section with no sources declaration", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "no-source-decl",
				body: "## Signal\n\nThis section has no `> sources:` line.\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({
				message: expect.stringContaining("first non-empty line after the heading must be a"),
			}),
		);
	});

	// WHY: an empty `> sources:` declaration is a particular failure mode the issue calls
	// out — it looks like a citation but conveys nothing.
	it("rejects an empty sources declaration", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "empty-source-decl",
				body: "## Signal\n\n> sources:\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining(`"> sources:" declaration is empty`) }),
		);
	});

	// WHY: an out-of-range index points at a citation that doesn't exist — same class of
	// bug as a typo'd related slug, same severity.
	it("rejects an out-of-range source index", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "oor-index",
				body: "## Signal\n\n> sources: 1, 5\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining(`source index "5" is out of range`) }),
		);
	});

	// WHY: ## Adjacent properties was a tempting structural addition; #16 explicitly bans
	// it because adjacency belongs in frontmatter.related, not duplicated in prose.
	it("rejects a `## Adjacent properties` body section", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "adjacent",
				body: "## Adjacent properties\n\n> sources: 1\n\n- linked stuff\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({
				message: expect.stringContaining(`"## Adjacent properties" body section is forbidden`),
			}),
		);
	});
});

describe("wiki linter — size + freshness warnings", () => {
	// WHY: oversize-page produces a warning, not an error — split-don't-truncate is a
	// guideline, and authors should not be blocked from landing a long page if they need
	// to. The signal must still surface in CI output.
	it("warns on a page over the soft line cap", async () => {
		const longBody = `## Signal\n\n> sources: 1\n\n${"- bullet\n".repeat(2100)}`;
		await writeWiki(dir, [{ kind: "role", slug: "huge", body: longBody }]);
		const { errors, warnings } = await lintWiki(dir);
		expect(errors).toEqual([]);
		expect(warnings).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("soft cap is 2000") }),
		);
	});

	// WHY: freshness is also a warning — stale pages still describe valid signals; the
	// staleness banner during review is the action, not a hard block.
	it("warns when updated_at is older than 12 months", async () => {
		await writeWiki(dir, [
			{
				kind: "role",
				slug: "old",
				frontmatter: [
					"---",
					"kind: role",
					"slug: old",
					"updated_at: 2024-01-01",
					"sources:",
					"  - https://example.com/one",
					"related: []",
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors, warnings } = await lintWiki(dir);
		expect(errors).toEqual([]);
		expect(warnings).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining("older than 12 months") }),
		);
	});
});

describe("wiki linter — split exercise", () => {
	// WHY: pins the #16 acceptance bullet "Splitting a page is exercised by a test
	// fixture: a page split into two narrower pages, with at least one inbound related
	// reference updated in the same operation". This test asserts the post-split state
	// passes the linter, and that NOT updating the inbound related reference makes it
	// fail — i.e. the linter actively guards the split operation.
	it("passes on a clean split with inbound related updated", async () => {
		await writeWiki(dir, [
			// "python" got split into "python-web" + "python-data". An inbound page must
			// drop "python" and reference the successors.
			{ kind: "skill", slug: "python-web", body: "## Signal\n\n> sources: 1\n\n- web stuff\n" },
			{ kind: "skill", slug: "python-data", body: "## Signal\n\n> sources: 1\n\n- data stuff\n" },
			{
				kind: "role",
				slug: "platform-eng",
				frontmatter: [
					"---",
					"kind: role",
					"slug: platform-eng",
					`updated_at: ${FRESH_DATE}`,
					"sources:",
					"  - https://example.com/one",
					"related:",
					"  - python-web",
					"  - python-data",
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toEqual([]);
	});

	it("fails when an inbound related still references the pre-split slug", async () => {
		await writeWiki(dir, [
			{ kind: "skill", slug: "python-web", body: "## Signal\n\n> sources: 1\n\n- web stuff\n" },
			{ kind: "skill", slug: "python-data", body: "## Signal\n\n> sources: 1\n\n- data stuff\n" },
			{
				kind: "role",
				slug: "platform-eng",
				frontmatter: [
					"---",
					"kind: role",
					"slug: platform-eng",
					`updated_at: ${FRESH_DATE}`,
					"sources:",
					"  - https://example.com/one",
					"related:",
					"  - python", // stale — wasn't updated when python.md was split
					"---",
				].join("\n"),
				body: "## Signal\n\n> sources: 1\n\n- x\n",
			},
		]);
		const { errors } = await lintWiki(dir);
		expect(errors).toContainEqual(
			expect.objectContaining({ message: expect.stringContaining(`related slug "python" does not resolve`) }),
		);
	});
});
