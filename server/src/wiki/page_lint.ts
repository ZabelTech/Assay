// #16 wiki linter. Lives in the server tree (rather than tools/) so the runtime
// WikiRepo (#17) can call it from production code without depending on the dev-mode
// tools/ directory.
//
// Two entry points:
// - lintWiki(rootDir): walks roles/ skills/ industries/ under rootDir.
// - lintPage(path, raw, otherSlugs?): validates a single page's text without
//   touching the filesystem. The optional otherSlugs lets a caller (e.g. WikiRepo
//   pre-commit) supply the slugs of pages already in the repo so related cross-link
//   integrity can be checked even when only one file is being staged.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { CORE_SCHEMA, load as parseYaml, YAMLException } from "js-yaml";

export type LintIssue = { path: string; message: string };
export type LintResult = { errors: LintIssue[]; warnings: LintIssue[] };

const VALID_KINDS = new Set(["role", "skill", "industry"] as const);
type Kind = "role" | "skill" | "industry";
const KIND_DIRS: Record<Kind, string> = { role: "roles", skill: "skills", industry: "industries" };
const SOFT_LINE_CAP = 2000;
const STALE_MS = 365 * 24 * 60 * 60 * 1000;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

interface Frontmatter {
	kind: Kind;
	slug: string;
	updated_at: string;
	updated_at_ms: number;
	sources: string[];
	related: string[];
}

interface ParsedPage {
	path: string;
	where: string;
	frontmatter: Frontmatter | null;
	body: string;
	lineCount: number;
}

export async function lintWiki(rootDir: string, now: number = Date.now()): Promise<LintResult> {
	const errors: LintIssue[] = [];
	const warnings: LintIssue[] = [];
	const pages = await loadPages(rootDir, errors);
	const slugs = new Set(
		pages.filter((p): p is ParsedPage & { frontmatter: Frontmatter } => p.frontmatter !== null).map((p) => p.frontmatter.slug),
	);
	for (const p of pages) {
		if (!p.frontmatter) continue;
		validatePage(p as ParsedPage & { frontmatter: Frontmatter }, slugs, now, errors, warnings);
	}
	return { errors, warnings };
}

// Single-page lint. `where` is the path label used in error messages (e.g.
// "skills/python.md"). `otherSlugs` provides extra valid slugs so the related
// cross-link check passes when only one page is in scope.
export function lintPage(
	where: string,
	raw: string,
	otherSlugs: Set<string> = new Set(),
	now: number = Date.now(),
): LintResult {
	const errors: LintIssue[] = [];
	const warnings: LintIssue[] = [];
	const parsed = parsePage(raw, where, where, errors);
	if (!parsed.frontmatter) return { errors, warnings };
	const slugs = new Set([...otherSlugs, parsed.frontmatter.slug]);
	validatePage(parsed as ParsedPage & { frontmatter: Frontmatter }, slugs, now, errors, warnings);
	return { errors, warnings };
}

// ---------------- loading ----------------

async function loadPages(rootDir: string, errors: LintIssue[]): Promise<ParsedPage[]> {
	const pages: ParsedPage[] = [];
	for (const kindDir of Object.values(KIND_DIRS)) {
		const dir = join(rootDir, kindDir);
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			// missing kind directory is fine; an empty wiki is valid.
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".md")) continue;
			const path = join(dir, name);
			const raw = await readFile(path, "utf8");
			pages.push(parsePage(raw, path, rootDir, errors));
		}
	}
	return pages;
}

function parsePage(raw: string, path: string, rootDir: string, errors: LintIssue[]): ParsedPage {
	const where = rootDir === path ? path : relative(rootDir, path);
	const match = raw.match(FRONTMATTER_RE);
	if (!match) {
		errors.push({ path: where, message: "missing or malformed YAML frontmatter (need leading `---` block)" });
		return { path, where, frontmatter: null, body: "", lineCount: 0 };
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(match[1]!, { schema: CORE_SCHEMA });
	} catch (err) {
		const msg = err instanceof YAMLException ? err.message : String(err);
		errors.push({ path: where, message: `frontmatter YAML parse error: ${msg}` });
		return { path, where, frontmatter: null, body: "", lineCount: 0 };
	}
	const fmResult = validateFrontmatter(parsed);
	if (fmResult.errors.length) {
		for (const e of fmResult.errors) errors.push({ path: where, message: e });
		return { path, where, frontmatter: null, body: "", lineCount: 0 };
	}
	const body = match[2] ?? "";
	const lineCount = raw.split(/\r?\n/).length;
	return { path, where, frontmatter: fmResult.frontmatter, body, lineCount };
}

// ---------------- frontmatter ----------------

function validateFrontmatter(value: unknown): { errors: string[]; frontmatter: Frontmatter | null } {
	const errors: string[] = [];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { errors: ["frontmatter must be a YAML mapping"], frontmatter: null };
	}
	const v = value as Record<string, unknown>;
	const out: Partial<Frontmatter> = {};

	if (typeof v.kind !== "string" || !VALID_KINDS.has(v.kind as Kind)) {
		errors.push(`frontmatter.kind must be one of ${[...VALID_KINDS].join(" | ")}`);
	} else {
		out.kind = v.kind as Kind;
	}

	if (typeof v.slug !== "string" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(v.slug)) {
		errors.push("frontmatter.slug must be a kebab-case scalar string");
	} else {
		out.slug = v.slug;
	}

	if (typeof v.updated_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.updated_at)) {
		errors.push("frontmatter.updated_at must be an ISO date (YYYY-MM-DD)");
	} else {
		const t = Date.parse(v.updated_at);
		if (Number.isNaN(t)) {
			errors.push("frontmatter.updated_at is not a valid date");
		} else {
			out.updated_at = v.updated_at;
			out.updated_at_ms = t;
		}
	}

	if (!Array.isArray(v.sources) || v.sources.some((s) => typeof s !== "string")) {
		errors.push("frontmatter.sources must be a non-empty list of URL strings");
	} else if (v.sources.length === 0) {
		errors.push("frontmatter.sources must contain at least one URL");
	} else {
		out.sources = v.sources as string[];
	}

	if (!Array.isArray(v.related) || v.related.some((s) => typeof s !== "string")) {
		errors.push("frontmatter.related must be a list of slug strings (may be empty)");
	} else {
		out.related = v.related as string[];
	}

	if (errors.length) return { errors, frontmatter: null };
	return { errors, frontmatter: out as Frontmatter };
}

// ---------------- page-level checks ----------------

function validatePage(
	page: ParsedPage & { frontmatter: Frontmatter },
	slugs: Set<string>,
	now: number,
	errors: LintIssue[],
	warnings: LintIssue[],
): void {
	const fileBase = page.path.split("/").pop() ?? page.path;
	const expectedSlug = fileBase.replace(/\.md$/, "");
	if (page.frontmatter.slug !== expectedSlug) {
		errors.push({
			path: page.where,
			message: `frontmatter.slug (${page.frontmatter.slug}) does not match filename slug (${expectedSlug})`,
		});
	}

	const expectedDir = KIND_DIRS[page.frontmatter.kind];
	if (expectedDir && page.path !== page.where && !page.path.includes(`/${expectedDir}/`)) {
		errors.push({
			path: page.where,
			message: `kind=${page.frontmatter.kind} pages must live under wiki/${expectedDir}/`,
		});
	}

	for (const slug of page.frontmatter.related) {
		if (!slugs.has(slug)) {
			errors.push({ path: page.where, message: `related slug "${slug}" does not resolve to any wiki page` });
		}
		if (slug === page.frontmatter.slug) {
			errors.push({ path: page.where, message: `related list refers to the page's own slug` });
		}
	}

	if (page.lineCount > SOFT_LINE_CAP) {
		warnings.push({
			path: page.where,
			message: `page is ${page.lineCount} lines, soft cap is ${SOFT_LINE_CAP} — split into narrower pages cross-linked via related`,
		});
	}

	if (now - page.frontmatter.updated_at_ms > STALE_MS) {
		warnings.push({
			path: page.where,
			message: `updated_at (${page.frontmatter.updated_at}) is older than 12 months — review for freshness`,
		});
	}

	validateBody(page, errors);
}

// ---------------- body / per-section sources ----------------

function validateBody(page: ParsedPage & { frontmatter: Frontmatter }, errors: LintIssue[]): void {
	const lines = page.body.split(/\r?\n/);
	const sections: { heading: string; firstNonEmpty: { lineIdx: number; text: string } | null }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const m = lines[i]!.match(/^##\s+(.*\S)\s*$/);
		if (!m) continue;
		const heading = m[1]!;
		if (/^adjacent\s+properties$/i.test(heading)) {
			errors.push({
				path: page.where,
				message: `"## Adjacent properties" body section is forbidden — adjacency is declared via frontmatter.related`,
			});
		}
		let firstNonEmpty: { lineIdx: number; text: string } | null = null;
		for (let j = i + 1; j < lines.length; j++) {
			const next = lines[j]!;
			if (/^##\s/.test(next)) break;
			if (next.trim() === "") continue;
			firstNonEmpty = { lineIdx: j, text: next };
			break;
		}
		sections.push({ heading, firstNonEmpty });
	}

	for (const s of sections) {
		if (!s.firstNonEmpty) {
			errors.push({
				path: page.where,
				message: `## ${s.heading}: section has no content; either delete it or add a "> sources: ..." declaration and body`,
			});
			continue;
		}
		const sourcesMatch = s.firstNonEmpty.text.match(/^>\s*sources:\s*(.*?)\s*$/i);
		if (!sourcesMatch) {
			errors.push({
				path: page.where,
				message: `## ${s.heading}: first non-empty line after the heading must be a "> sources: N, M, ..." blockquote`,
			});
			continue;
		}
		const indicesRaw = sourcesMatch[1]!.trim();
		if (indicesRaw === "") {
			errors.push({
				path: page.where,
				message: `## ${s.heading}: "> sources:" declaration is empty — provide at least one index or remove the section`,
			});
			continue;
		}
		const indices = indicesRaw.split(",").map((t) => t.trim());
		for (const idx of indices) {
			const n = Number(idx);
			if (!Number.isInteger(n) || n < 1 || n > page.frontmatter.sources.length) {
				errors.push({
					path: page.where,
					message: `## ${s.heading}: source index "${idx}" is out of range 1..${page.frontmatter.sources.length}`,
				});
			}
		}
	}
}
