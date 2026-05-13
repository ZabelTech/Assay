// #15 WikiReader — read-only view of the local wiki repo (PR B's WikiRepo,
// seeded from #16's wiki/). The structurer consumes this to make extraction
// target-aware: it can look up "is there a wiki page for staff-platform-
// engineer?" and read the page's signal / evidence sections to weight its
// extraction decisions.
//
// Returned shape mirrors the type sketch in the #15 issue body. The reader
// also records usage events so the freshness exemption logic (future) has the
// data it needs — the table is wired in this PR, the staleness logic is not.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_SCHEMA, load as parseYaml } from "js-yaml";

export type WikiKind = "role" | "skill" | "industry";

export interface WikiPageRef {
	kind: WikiKind;
	slug: string;
	updated_at: string;
}

export interface WikiSection {
	heading: string;
	sources: number[]; // 1-based indices into frontmatter.sources
	body: string;
}

export interface WikiPage {
	ref: WikiPageRef;
	frontmatter: {
		kind: WikiKind;
		slug: string;
		updated_at: string;
		sources: string[];
		related: string[];
	};
	sections: WikiSection[];
}

export interface WikiReader {
	list(kind?: WikiKind): WikiPageRef[];
	read(slug: string): WikiPage;
	// Called by the pipeline whenever the structurer consumed a wiki page in
	// a run — records to the wiki_page_uses table so freshness-by-use can
	// later exempt re-validated pages from the staleness warning. The logic
	// is out of scope for v0; only the data hook ships.
	recordUse?(slug: string, claim_id: string): void;
}

const KIND_DIRS: Record<WikiKind, string> = {
	role: "roles",
	skill: "skills",
	industry: "industries",
};

interface CachedPage {
	page: WikiPage;
	path: string;
}

// Filesystem-backed reader. Loads all pages eagerly at construction so reads
// are synchronous (matches the interface; the structurer's loop is
// synchronous). Production wires this against the local wiki repo's checkout
// (PR B's wikiRepoDir); tests wire it against the project wiki/ for fixture
// reuse.
export class FsWikiReader implements WikiReader {
	private bySlug = new Map<string, CachedPage>();

	private constructor(private readonly rootDir: string) {}

	static async load(rootDir: string): Promise<FsWikiReader> {
		const reader = new FsWikiReader(rootDir);
		await reader.loadAll();
		return reader;
	}

	list(kind?: WikiKind): WikiPageRef[] {
		const refs: WikiPageRef[] = [];
		for (const { page } of this.bySlug.values()) {
			if (kind && page.ref.kind !== kind) continue;
			refs.push(page.ref);
		}
		return refs.sort((a, b) => a.slug.localeCompare(b.slug));
	}

	read(slug: string): WikiPage {
		const cached = this.bySlug.get(slug);
		if (!cached) throw new Error(`wiki page not found: ${slug}`);
		return cached.page;
	}

	private async loadAll(): Promise<void> {
		for (const [kind, dir] of Object.entries(KIND_DIRS) as [WikiKind, string][]) {
			const full = join(this.rootDir, dir);
			let names: string[];
			try {
				names = await readdir(full);
			} catch {
				continue;
			}
			for (const name of names) {
				if (!name.endsWith(".md")) continue;
				const path = join(full, name);
				const raw = await readFile(path, "utf8");
				const page = parsePage(raw, kind);
				if (page) this.bySlug.set(page.frontmatter.slug, { page, path });
			}
		}
	}
}

// Stub reader for tests that don't want to set up a wiki repo. list() returns
// empty; read() throws.
export class EmptyWikiReader implements WikiReader {
	list(): WikiPageRef[] {
		return [];
	}
	read(slug: string): WikiPage {
		throw new Error(`wiki page not found (EmptyWikiReader): ${slug}`);
	}
}

// ---------------- parser ----------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parsePage(raw: string, expectedKind: WikiKind): WikiPage | null {
	const m = raw.match(FRONTMATTER_RE);
	if (!m) return null;
	let fm: unknown;
	try {
		fm = parseYaml(m[1]!, { schema: CORE_SCHEMA });
	} catch {
		return null;
	}
	if (!fm || typeof fm !== "object" || Array.isArray(fm)) return null;
	const v = fm as Record<string, unknown>;
	if (v.kind !== expectedKind) return null;
	if (typeof v.slug !== "string") return null;
	if (typeof v.updated_at !== "string") return null;
	if (!Array.isArray(v.sources)) return null;
	if (!Array.isArray(v.related)) return null;

	const body = m[2] ?? "";
	const sections = parseSections(body);

	return {
		ref: { kind: expectedKind, slug: v.slug, updated_at: v.updated_at },
		frontmatter: {
			kind: expectedKind,
			slug: v.slug,
			updated_at: v.updated_at,
			sources: v.sources as string[],
			related: v.related as string[],
		},
		sections,
	};
}

function parseSections(body: string): WikiSection[] {
	const lines = body.split(/\r?\n/);
	const sections: WikiSection[] = [];
	let i = 0;
	while (i < lines.length) {
		const m = lines[i]!.match(/^##\s+(.*\S)\s*$/);
		if (!m) {
			i++;
			continue;
		}
		const heading = m[1]!;
		// Look ahead for the `> sources: N, M, ...` blockquote.
		let j = i + 1;
		let sources: number[] = [];
		while (j < lines.length && lines[j]!.trim() === "") j++;
		const sm = j < lines.length ? lines[j]!.match(/^>\s*sources:\s*(.*?)\s*$/i) : null;
		if (sm) {
			sources = sm[1]!.split(",").map((t) => Number.parseInt(t.trim(), 10)).filter((n) => Number.isFinite(n));
			j++;
		}
		// Body = everything until the next ## heading.
		const start = j;
		while (j < lines.length && !/^##\s/.test(lines[j]!)) j++;
		const sectionBody = lines.slice(start, j).join("\n").trim();
		sections.push({ heading, sources, body: sectionBody });
		i = j;
	}
	return sections;
}
