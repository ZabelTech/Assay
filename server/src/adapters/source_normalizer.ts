// #15 SourceNormalizer adapter set. Each impl takes raw bytes/text from an
// import path and emits the markdown body + YAML-frontmatter that the corpus
// stores. Normalizers are deterministic and LLM-free; sub-item splitting
// (LinkedIn articles → per-article files, GitHub repos → per-repo files) is a
// normalizer's responsibility for its source type — handled by the
// `additional` return value below, which the pipeline writes as sibling
// files.
import type { CorpusFrontmatter } from "../pipeline/types.js";
import type { PdfParser } from "./pdf_parser.js";

export interface NormalizedSource {
	// The primary corpus file body — what the structurer reads as "the
	// linkedin.md / github.md / paste.md for this import."
	body: string;
	frontmatter: Pick<CorpusFrontmatter, "source_type" | "source_url">;
	// Optional sibling corpus files for sub-items (LinkedIn articles, GitHub
	// repos, etc.). The pipeline writes these alongside the primary file with
	// `path` resolved relative to the candidate corpus root.
	additional?: AdditionalSource[];
}

export interface AdditionalSource {
	relativePath: string; // e.g. "linkedin/articles/some-slug.md"
	body: string;
	frontmatter: Pick<CorpusFrontmatter, "source_type" | "source_url">;
}

export interface NormalizeContext {
	source_url?: string;
	media_type?: string;
}

export interface SourceNormalizer {
	// Buffer for binary sources (PDF, image); string for text sources (paste,
	// HTML, JSON). The pipeline picks the type at the call site and forwards
	// any context (e.g. source_url for url-snapshot) so the normalizer can
	// populate its frontmatter.
	normalize(raw: Buffer | string, context?: NormalizeContext): Promise<NormalizedSource>;
}

export type SourceNormalizerRegistry = Record<string, SourceNormalizer>;

// ---------------- paste ----------------

export class PasteNormalizer implements SourceNormalizer {
	async normalize(raw: Buffer | string): Promise<NormalizedSource> {
		const text = typeof raw === "string" ? raw : raw.toString("utf8");
		return {
			body: text,
			frontmatter: { source_type: "paste", source_url: null },
		};
	}
}

// ---------------- pdf ----------------

export class PdfNormalizer implements SourceNormalizer {
	constructor(private parser: PdfParser) {}

	async normalize(raw: Buffer | string): Promise<NormalizedSource> {
		const bytes = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
		const text = await this.parser.extractText(bytes);
		return {
			body: text,
			frontmatter: { source_type: "pdf", source_url: null },
		};
	}
}

// ---------------- linkedin ----------------
// Input is the OAuth profile JSON (as returned by OAuthProvider.fetchProfile).
// The normalizer parses for the well-known top-level fields and emits a
// primary `linkedin.md` plus per-article files under `linkedin/articles/`.

export class LinkedinNormalizer implements SourceNormalizer {
	async normalize(raw: Buffer | string): Promise<NormalizedSource> {
		const text = typeof raw === "string" ? raw : raw.toString("utf8");
		const parsed = safeParseJson(text);
		const lines: string[] = [];
		if (parsed.name) lines.push(`# ${parsed.name}`);
		if (parsed.headline) lines.push(`\n${parsed.headline}`);
		if (Array.isArray(parsed.positions)) {
			lines.push("\n## Positions");
			for (const p of parsed.positions) {
				lines.push(`- **${p?.title ?? "?"}** at ${p?.company ?? "?"}${p?.dates ? ` (${p.dates})` : ""}`);
			}
		}
		if (typeof parsed.about === "string") {
			lines.push("\n## About\n\n" + parsed.about);
		}
		// Fall through: include the raw JSON at the end so the structurer always
		// has every field the OAuth provider returned, even when this normalizer
		// doesn't know how to render it.
		lines.push("\n## Raw JSON\n\n```\n" + text + "\n```");

		const additional: AdditionalSource[] = [];
		if (Array.isArray(parsed.articles)) {
			for (const a of parsed.articles) {
				if (!a?.slug || typeof a.body !== "string") continue;
				additional.push({
					relativePath: `linkedin/articles/${a.slug}.md`,
					body: `# ${a.title ?? a.slug}\n\n${a.body}\n`,
					frontmatter: { source_type: "linkedin", source_url: a.url ?? null },
				});
			}
		}

		return {
			body: lines.join("\n") + "\n",
			frontmatter: { source_type: "linkedin", source_url: parsed.profile_url ?? null },
			additional,
		};
	}
}

// ---------------- github ----------------
// Same shape as LinkedinNormalizer — parses the OAuth fetch result and emits
// a primary github.md plus per-repo sub-files under github/repos/.

export class GithubNormalizer implements SourceNormalizer {
	async normalize(raw: Buffer | string): Promise<NormalizedSource> {
		const text = typeof raw === "string" ? raw : raw.toString("utf8");
		const parsed = safeParseJson(text);
		const lines: string[] = [];
		if (parsed.login) lines.push(`# ${parsed.login}`);
		if (parsed.name) lines.push(`\n${parsed.name}`);
		if (typeof parsed.bio === "string") lines.push(`\n${parsed.bio}`);

		const additional: AdditionalSource[] = [];
		if (Array.isArray(parsed.repos)) {
			lines.push("\n## Repositories");
			for (const r of parsed.repos) {
				const slug = `${r?.owner ?? parsed.login ?? "unknown"}-${r?.name ?? "repo"}`;
				lines.push(`- [${r?.name}](${r?.url ?? ""}) — ${r?.description ?? ""}`);
				if (r?.name) {
					additional.push({
						relativePath: `github/repos/${slug}.md`,
						body:
							`# ${r.name}\n\n` +
							(r.description ?? "") +
							"\n\n" +
							(r.readme ?? "") +
							"\n",
						frontmatter: { source_type: "github", source_url: r.url ?? null },
					});
				}
			}
		}

		lines.push("\n## Raw JSON\n\n```\n" + text + "\n```");

		return {
			body: lines.join("\n") + "\n",
			frontmatter: { source_type: "github", source_url: parsed.profile_url ?? null },
			additional,
		};
	}
}

// ---------------- url-snapshot ----------------
// Pairs with #17's UrlSnapshotFetcher. The fetcher returns raw bytes; this
// normalizer turns them into corpus markdown. For v0 we keep it
// pass-through-with-codeblock — full HTML→markdown is a follow-up and not in
// the load-bearing path (the verifier reads the corpus body for substring
// matching, which works on the raw text as well).
//
// Implements SourceNormalizer so the pipeline drives it via the registry like
// every other normalizer. The pipeline passes the source_url and media_type
// through `context`; without context (i.e. when called from a non-pipeline
// path) the normalizer falls back to source_url=null and a plain code-fence.

export class UrlSnapshotNormalizer implements SourceNormalizer {
	async normalize(raw: Buffer | string, context?: NormalizeContext): Promise<NormalizedSource> {
		const bytes = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
		const text = bytes.toString("utf8");
		const mediaType = context?.media_type ?? "application/octet-stream";
		const body = /^text\/markdown\b/i.test(mediaType) ? text : "```\n" + text + "\n```";
		return {
			body,
			frontmatter: { source_type: "url-snapshot", source_url: context?.source_url ?? null },
		};
	}
}

function safeParseJson(text: string): Record<string, any> {
	try {
		const v = JSON.parse(text);
		return typeof v === "object" && v !== null ? v : {};
	} catch {
		return {};
	}
}
