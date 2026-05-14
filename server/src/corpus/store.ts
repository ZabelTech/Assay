// #15 filesystem-backed corpus store. Writes markdown files versioned as
// `<logical-path>.v<N>.md` so older versions stay on disk and origin pointers
// pinned by the structurer at run time keep resolving even after a re-import
// bumps the version.
//
// Layout:
//   candidate-corpus/{subject}/sources/
//     linkedin.v1.md
//     linkedin.v2.md         <- the current version
//     paste.v1.md
//     linkedin/articles/foo.v1.md
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { dump as dumpYaml } from "js-yaml";
import type { CorpusFile, CorpusFrontmatter } from "../pipeline/types.js";
import type { CorpusMetadata } from "../storage/corpus_metadata.repo.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

// Defence-in-depth against LLM-influenced origin paths. The structurer is fed
// candidate-uploaded content; a successful prompt-injection that nudges it to
// emit a path like `linkedin/../../etc/cairn.db` would otherwise escape the
// per-subject sources/ sandbox when `join()`-resolved. Logical paths are
// always relative, slash-separated, no traversal, no NULs, no embedded subject
// segment.
export function assertSafeCorpusPath(path: string): void {
	if (typeof path !== "string" || path.length === 0) {
		throw new Error("corpus path must be a non-empty string");
	}
	if (path.includes("\0")) {
		throw new Error("corpus path contains NUL byte");
	}
	if (path.startsWith("/") || path.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(path)) {
		throw new Error(`corpus path must be relative: ${path}`);
	}
	for (const segment of path.split(/[\\/]/)) {
		if (segment === "" || segment === "." || segment === "..") {
			throw new Error(`corpus path contains forbidden segment "${segment}": ${path}`);
		}
	}
}

export class CorpusStore {
	constructor(private readonly rootDir: string) {}

	// Writes a versioned corpus file to disk. Returns the on-disk path so the
	// pipeline can record a stable handle. The caller (the pipeline) decides
	// the version; the store does not invent one.
	async writeVersion(opts: {
		subject: string;
		path: string;
		version: number;
		frontmatter: CorpusFrontmatter;
		body: string;
	}): Promise<{ onDiskPath: string }> {
		const onDiskPath = this.resolveOnDisk(opts.subject, opts.path, opts.version);
		await mkdir(dirname(onDiskPath), { recursive: true });
		const fm = `---\n${dumpYaml(opts.frontmatter, { lineWidth: -1 })}---\n`;
		await writeFile(onDiskPath, fm + opts.body, "utf8");
		return { onDiskPath };
	}

	// Reads a specific version. The caller (CorpusReader) maps a logical
	// `(path, version)` from SQLite metadata into the on-disk filename via
	// `resolveOnDisk` below; this method then parses the on-disk file.
	async readVersion(opts: { subject: string; path: string; version: number }): Promise<CorpusFile> {
		const onDiskPath = this.resolveOnDisk(opts.subject, opts.path, opts.version);
		const raw = await readFile(onDiskPath, "utf8");
		const m = raw.match(FRONTMATTER_RE);
		if (!m) {
			// We control writing — if a file is on disk without frontmatter it's
			// a bug. Fail loud.
			throw new Error(`corpus file ${onDiskPath} is missing frontmatter`);
		}
		const frontmatter = parseFrontmatterMinimal(m[1]!);
		return {
			path: opts.path,
			version: opts.version,
			frontmatter,
			body: m[2] ?? "",
		};
	}

	// Helper used by the CorpusMetadata-backed reader. Returns the on-disk
	// filename. Logical path "linkedin.md" → "linkedin.v3.md"; logical
	// "linkedin/articles/foo.md" → "linkedin/articles/foo.v3.md".
	resolveOnDisk(subject: string, path: string, version: number): string {
		assertSafeCorpusPath(path);
		const ext = extname(path) || ".md";
		const stem = path.slice(0, path.length - ext.length);
		return join(this.rootDir, subject, "sources", `${stem}.v${version}${ext}`);
	}
}

// Tiny strict parser for the subset we write (we control the format, so we
// don't need a full YAML parser at read time — but use js-yaml CORE to be
// safe and consistent with the linter).
function parseFrontmatterMinimal(yaml: string): CorpusFrontmatter {
	const fields: Record<string, string | null> = {};
	for (const line of yaml.split(/\r?\n/)) {
		const m = line.match(/^([a-z_]+):\s*(.*)$/);
		if (!m) continue;
		const key = m[1]!;
		let value: string | null = m[2]!.trim();
		// Unquote the YAML scalar — dumpYaml may quote strings containing
		// special chars; strip surrounding quotes if present. null sentinel
		// recognized as "null" or "~".
		if (value === "null" || value === "~") value = null;
		else if (/^".*"$/.test(value)) value = value.slice(1, -1);
		else if (/^'.*'$/.test(value)) value = value.slice(1, -1);
		fields[key] = value;
	}
	return {
		source_type: fields.source_type ?? "",
		source_url: fields.source_url ?? null,
		fetched_at: fields.fetched_at ?? "",
		content_hash: fields.content_hash ?? "",
	};
}
