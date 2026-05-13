// #16 wiki linter library. Walks a wiki/ directory and returns errors + warnings.
// Errors fail CI; warnings do not. The CLI (index.mjs) prints both and exits non-zero
// when errors.length > 0.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { CORE_SCHEMA, load as parseYaml, YAMLException } from "js-yaml";

const VALID_KINDS = new Set(["role", "skill", "industry"]);
const KIND_DIRS = { role: "roles", skill: "skills", industry: "industries" };
const SOFT_LINE_CAP = 2000;
const STALE_MS = 365 * 24 * 60 * 60 * 1000;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export async function lintWiki(rootDir, now = Date.now()) {
	const errors = [];
	const warnings = [];
	const pages = await loadPages(rootDir, errors);
	const slugs = new Set(pages.filter((p) => p.frontmatter).map((p) => p.frontmatter.slug));
	for (const p of pages) {
		if (!p.frontmatter) continue;
		validatePage(p, slugs, now, errors, warnings);
	}
	return { errors, warnings };
}

// ---------------- loading ----------------

async function loadPages(rootDir, errors) {
	const pages = [];
	for (const kindDir of Object.values(KIND_DIRS)) {
		const dir = join(rootDir, kindDir);
		let names;
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

function parsePage(raw, path, rootDir, errors) {
	const where = relative(rootDir, path);
	const match = raw.match(FRONTMATTER_RE);
	if (!match) {
		errors.push({ path: where, message: "missing or malformed YAML frontmatter (need leading `---` block)" });
		return { path, where, frontmatter: null };
	}
	let parsed;
	try {
		parsed = parseYaml(match[1], { schema: CORE_SCHEMA });
	} catch (err) {
		const msg = err instanceof YAMLException ? err.message : String(err);
		errors.push({ path: where, message: `frontmatter YAML parse error: ${msg}` });
		return { path, where, frontmatter: null };
	}
	const fmResult = validateFrontmatter(parsed);
	if (fmResult.errors.length) {
		for (const e of fmResult.errors) errors.push({ path: where, message: e });
		return { path, where, frontmatter: null };
	}
	const body = match[2] ?? "";
	const lineCount = raw.split(/\r?\n/).length;
	return { path, where, frontmatter: fmResult.frontmatter, body, lineCount };
}

// ---------------- frontmatter ----------------

function validateFrontmatter(value) {
	const errors = [];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { errors: ["frontmatter must be a YAML mapping"], frontmatter: null };
	}
	const v = value;
	const out = {};

	if (typeof v.kind !== "string" || !VALID_KINDS.has(v.kind)) {
		errors.push(`frontmatter.kind must be one of ${[...VALID_KINDS].join(" | ")}`);
	} else {
		out.kind = v.kind;
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
		out.sources = v.sources;
	}

	if (!Array.isArray(v.related) || v.related.some((s) => typeof s !== "string")) {
		errors.push("frontmatter.related must be a list of slug strings (may be empty)");
	} else {
		out.related = v.related;
	}

	return errors.length ? { errors, frontmatter: null } : { errors, frontmatter: out };
}

// ---------------- page-level checks ----------------

function validatePage(page, slugs, now, errors, warnings) {
	const expectedSlug = page.path.split("/").pop().replace(/\.md$/, "");
	if (page.frontmatter.slug !== expectedSlug) {
		errors.push({
			path: page.where,
			message: `frontmatter.slug (${page.frontmatter.slug}) does not match filename slug (${expectedSlug})`,
		});
	}

	const expectedDir = KIND_DIRS[page.frontmatter.kind];
	if (expectedDir && !page.path.includes(`/${expectedDir}/`)) {
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

function validateBody(page, errors) {
	const lines = page.body.split(/\r?\n/);
	const sections = []; // { heading, headingLine, firstNonEmptyLine, content[] }

	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^##\s+(.*\S)\s*$/);
		if (!m) continue;
		const heading = m[1];
		if (/^adjacent\s+properties$/i.test(heading)) {
			errors.push({
				path: page.where,
				message: `"## Adjacent properties" body section is forbidden — adjacency is declared via frontmatter.related`,
			});
		}
		let firstNonEmpty = null;
		for (let j = i + 1; j < lines.length; j++) {
			const next = lines[j];
			if (/^##\s/.test(next)) break;
			if (next.trim() === "") continue;
			firstNonEmpty = { lineIdx: j, text: next };
			break;
		}
		sections.push({ heading, headingLine: i + 1, firstNonEmpty });
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
		const indicesRaw = sourcesMatch[1].trim();
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
