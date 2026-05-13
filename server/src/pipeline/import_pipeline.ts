// #15 ImportPipeline. Deterministic orchestrator that sits between #7's admin
// import endpoints and the new Structurer/Verifier adapters. Owns:
//   raw → normalize → corpus write + raw artifact capture → structurer →
//   persist drafts (+ conflicts + wiki proposals) → publish → verify →
//   evidence rewrite → insert into claims (atomic).
//
// No LLM calls in this layer — the pipeline talks only to adapter interfaces.
// The Structurer and Verifier are the pluggability points.
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { Claim, DocumentEvidence, UrlEvidence, Evidence } from "../domain/types.js";
import { getValueValidator } from "../domain/validators.js";
import type { EvidenceStore } from "../adapters/evidence_store.js";
import type {
	NormalizedSource,
	SourceNormalizerRegistry,
} from "../adapters/source_normalizer.js";
import type { Structurer } from "../adapters/structurer.js";
import type { Verifier } from "../adapters/verifier.js";
import type { WebSearch } from "../adapters/web_search.js";
import type { WikiReader } from "../wiki/reader.js";
import type {
	ConflictRecord,
	CorpusFile,
	CorpusFrontmatter,
	DraftInput,
	StructureResult,
	Target,
	WikiProposalDraft,
} from "./types.js";
import type { ClaimsRepo } from "../storage/claims.repo.js";
import type { ClaimDraftsRepo, ClaimDraft } from "../storage/claim_drafts.repo.js";
import type { ConflictsRepo } from "../storage/conflicts.repo.js";
import type { CorpusMetadataRepo, CorpusMetadata } from "../storage/corpus_metadata.repo.js";
import type { PendingWikiProposalsRepo } from "../storage/pending_wiki_proposals.repo.js";
import type { WikiPageUsesRepo } from "../storage/wiki_page_uses.repo.js";
import type { CorpusStore } from "../corpus/store.js";
import { buildPrimedCorpusReader } from "../corpus/reader.js";
import { detectContradictions } from "./contradiction.js";

export class PipelineError extends Error {
	constructor(
		message: string,
		public readonly stage: "ingest" | "publish" | "verify",
		public readonly detail?: string,
	) {
		super(message);
		this.name = "PipelineError";
	}
}

export interface IngestInput {
	raw: Buffer | string;
	source_type: string; // key in SourceNormalizerRegistry: paste / pdf / linkedin / github / url-snapshot
	source_url?: string; // optional; used for url-snapshot and linkedin / github profile_url
	subject: string;
	target?: Target;
	// Raw artifact storage. For paste/pdf the caller supplies the raw bytes
	// directly; for OAuth profile fetches the caller supplies the JSON payload.
	rawMediaType: string;
}

export interface IngestResult {
	drafts: ClaimDraft[];
	conflict_ids: string[];
	wiki_proposal_ids: string[];
	corpus_paths: { path: string; version: number; source_type: string }[];
}

export interface PublishInput {
	draft_ids: string[];
	subject: string;
}

export interface PublishResult {
	claim_ids: string[];
}

export interface ImportPipelineDeps {
	db: Database;
	corpusStore: CorpusStore;
	corpusMetadata: CorpusMetadataRepo;
	evidenceStore: EvidenceStore;
	claims: ClaimsRepo;
	drafts: ClaimDraftsRepo;
	conflicts: ConflictsRepo;
	wikiProposals: PendingWikiProposalsRepo;
	wikiPageUses: WikiPageUsesRepo;
	wikiReader: WikiReader;
	web: WebSearch;
	normalizers: SourceNormalizerRegistry;
	structurer: Structurer;
	verifier: Verifier;
}

export class ImportPipeline {
	constructor(private readonly deps: ImportPipelineDeps) {}

	async ingest(input: IngestInput): Promise<IngestResult> {
		const normalizer = this.deps.normalizers[input.source_type];
		if (!normalizer) {
			throw new PipelineError(
				`no SourceNormalizer registered for source_type "${input.source_type}"`,
				"ingest",
			);
		}

		// 1) Capture the raw artifact. Always — even when re-import is a no-op,
		//    the raw artifact is the audit trail of "what came in this run".
		const rawBuffer = typeof input.raw === "string" ? Buffer.from(input.raw, "utf8") : input.raw;
		const rawPut = this.deps.evidenceStore.put(rawBuffer, input.rawMediaType);

		// 2) Normalize raw → markdown corpus file(s).
		const normalized: NormalizedSource = await normalizer.normalize(input.raw);

		// 3) Write the primary corpus file and any sub-items the normalizer
		//    surfaced (LinkedIn articles, GitHub repos), bumping the version
		//    when content_hash changes vs. the prior version.
		const primaryPath = primaryPathFor(input.source_type);
		const writtenCorpus: WrittenCorpus[] = [];
		writtenCorpus.push(
			await this.writeOneCorpusVersion({
				subject: input.subject,
				logicalPath: primaryPath,
				body: normalized.body,
				frontmatter: normalized.frontmatter,
				rawPut,
				rawMediaType: input.rawMediaType,
			}),
		);
		if (normalized.additional) {
			for (const a of normalized.additional) {
				writtenCorpus.push(
					await this.writeOneCorpusVersion({
						subject: input.subject,
						logicalPath: a.relativePath,
						body: a.body,
						frontmatter: a.frontmatter,
						rawPut,
						rawMediaType: input.rawMediaType,
					}),
				);
			}
		}

		// 4) Build the primed CorpusReader (sync read access for the
		//    structurer) over the now-current set of files.
		const corpus = await buildPrimedCorpusReader(
			input.subject,
			this.deps.corpusMetadata,
			this.deps.corpusStore,
		);

		// 5) Invoke the structurer. This is the ONLY LLM call site in the
		//    pipeline (or in the Mock's case, fixture lookup). new_origins
		//    tells the structurer which corpus files are fresh this run; the
		//    Mock uses it to restrict the run to the just-ingested files.
		const result: StructureResult = await this.deps.structurer.structure({
			corpus,
			wiki: this.deps.wikiReader,
			web: this.deps.web,
			target: input.target,
			new_origins: writtenCorpus.map((w) => ({ path: w.path, version: w.version })),
		});

		// 6) Persist drafts (with per-type validation fallback to narrative)
		//    and conflicts and wiki proposals into their respective tables.
		const drafts: ClaimDraft[] = [];
		const conflict_ids: string[] = [];
		const wiki_proposal_ids: string[] = [];

		// Deterministic re-import contradiction check (same-type +
		// overlapping date range + value differs against existing published
		// claims). Emits ConflictRecords with one draft contender + one
		// published contender.
		const reImportConflicts = detectContradictions({
			subject: input.subject,
			drafts: result.drafts,
			claims: this.deps.claims,
		});
		const allConflicts: ConflictRecord[] = [...result.conflicts, ...reImportConflicts];

		const tx = this.deps.db.transaction(() => {
			for (const d of result.drafts) {
				if (!d.origin || d.origin.length === 0) {
					throw new PipelineError(
						`structurer returned a draft with no origin pointer; rejecting`,
						"ingest",
					);
				}
				// Per-type value validation. If it fails, wrap the extracted
				// text in a `narrative` claim that preserves the original
				// content (rule 11: fail loud — narrative wrapper is the
				// documented fallback, not a silent drop).
				const validated = validateOrFallback(d);
				const created = this.deps.drafts.create({
					source: validated.source ?? d.origin[0]!.path.split(".")[0] ?? "unknown",
					type: validated.type,
					value: validated.value,
					visibility: validated.visibility,
					origin: d.origin,
				});
				drafts.push(created);
			}
			for (const c of allConflicts) {
				const id = this.deps.conflicts.create({
					subject: input.subject,
					contenders: c.contenders,
					rationale: c.rationale,
				});
				conflict_ids.push(id);
			}
			for (const p of result.wiki_proposals ?? []) {
				const created = this.deps.wikiProposals.create({
					kind: p.kind,
					slug: p.slug,
					markdown: p.markdown,
					target: input.target?.free_text ?? input.target?.role ?? input.target?.industry,
				});
				wiki_proposal_ids.push(created.proposal_id);
			}
		});
		tx();

		return {
			drafts,
			conflict_ids,
			wiki_proposal_ids,
			corpus_paths: writtenCorpus.map((w) => ({ path: w.path, version: w.version, source_type: w.source_type })),
		};
	}

	async publish(input: PublishInput): Promise<PublishResult> {
		const claim_ids: string[] = [];

		// We can't run async work inside a SQLite transaction (better-sqlite3
		// transactions are synchronous), so verify first, then commit. The
		// commit is atomic; verification failures rollback by not entering
		// the commit at all.
		const prepared: { draft: ClaimDraft; evidence: Evidence[] }[] = [];

		for (const draft_id of input.draft_ids) {
			const draft = this.deps.drafts.get(draft_id);
			if (!draft) throw new PipelineError(`draft ${draft_id} not found`, "publish");

			// Resolve every origin pointer to its CorpusFile + raw artifact
			// metadata. The pipeline always wrote origins at ingest, but #7
			// legacy direct creates won't have any — treat empty origin as
			// "trust without verification" for back-compat.
			const cited_corpus: CorpusFile[] = [];
			const evidence: Evidence[] = [];
			for (const o of draft.origin ?? []) {
				const meta = this.deps.corpusMetadata.getVersion(input.subject, o.path, o.version);
				if (!meta) {
					throw new PipelineError(
						`corpus origin ${o.path} v${o.version} not found for subject ${input.subject}`,
						"publish",
					);
				}
				const file = await this.deps.corpusStore.readVersion({
					subject: input.subject,
					path: o.path,
					version: o.version,
				});
				cited_corpus.push(file);
				evidence.push(buildRawArtifactEvidence(meta));
				if (meta.source_url) {
					evidence.push({ type: "url", url: meta.source_url, label: "source" } satisfies UrlEvidence);
				}
			}

			if (cited_corpus.length > 0) {
				const draftInput: DraftInput = {
					type: draft.type,
					value: draft.value,
					visibility: draft.visibility,
					origin: draft.origin ?? [],
				};
				const verdict = await this.deps.verifier.verify({ draft: draftInput, cited_corpus });
				if (!verdict.ok) {
					throw new PipelineError(
						`publish rejected by Verifier: ${verdict.reason}`,
						"verify",
						verdict.reason,
					);
				}
			}

			prepared.push({ draft, evidence });
		}

		// Atomic commit.
		const tx = this.deps.db.transaction(() => {
			for (const { draft, evidence } of prepared) {
				const now = new Date().toISOString();
				const claim: Claim = {
					claim_id: `clm_${randomBytes(8).toString("hex")}`,
					subject: input.subject,
					type: draft.type,
					value: draft.value,
					evidence: evidence.length > 0 ? evidence : undefined,
					attestation: { level: "self_attested" },
					visibility: draft.visibility,
					created_at: now,
					updated_at: now,
				};
				this.deps.claims.insert(claim);
				// Drop the draft now that it's a claim.
				this.deps.drafts.delete(draft.draft_id);
				claim_ids.push(claim.claim_id);
			}
		});
		tx();

		return { claim_ids };
	}

	// ---------------- internals ----------------

	private async writeOneCorpusVersion(opts: {
		subject: string;
		logicalPath: string;
		body: string;
		frontmatter: { source_type: string; source_url: string | null };
		rawPut: { stored_url: string; content_hash: string };
		rawMediaType: string;
	}): Promise<WrittenCorpus> {
		const content_hash = `sha256:${createHash("sha256").update(opts.body).digest("hex")}`;
		const prior = this.deps.corpusMetadata.getLatest(opts.subject, opts.logicalPath);
		const nextVersion = prior ? prior.version + 1 : 1;

		// Idempotence: if the content hash matches the prior version, no new
		// version is written. The candidate sees a no-op re-import (the
		// corpus is unchanged). Drafts produced by the structurer this run
		// pin against the existing version.
		if (prior && prior.content_hash === content_hash) {
			return {
				path: opts.logicalPath,
				version: prior.version,
				source_type: opts.frontmatter.source_type,
			};
		}

		const fetchedAt = new Date().toISOString();
		const fullFrontmatter: CorpusFrontmatter = {
			source_type: opts.frontmatter.source_type,
			source_url: opts.frontmatter.source_url,
			fetched_at: fetchedAt,
			content_hash,
		};
		await this.deps.corpusStore.writeVersion({
			subject: opts.subject,
			path: opts.logicalPath,
			version: nextVersion,
			frontmatter: fullFrontmatter,
			body: opts.body,
		});
		this.deps.corpusMetadata.insert({
			subject: opts.subject,
			path: opts.logicalPath,
			version: nextVersion,
			source_type: opts.frontmatter.source_type,
			source_url: opts.frontmatter.source_url,
			fetched_at: fetchedAt,
			content_hash,
			raw_storage_ref: opts.rawPut.stored_url,
			raw_content_hash: opts.rawPut.content_hash,
			raw_media_type: opts.rawMediaType,
		});
		return { path: opts.logicalPath, version: nextVersion, source_type: opts.frontmatter.source_type };
	}
}

interface WrittenCorpus {
	path: string;
	version: number;
	source_type: string;
}

function primaryPathFor(source_type: string): string {
	// Logical (not on-disk) path. The on-disk path adds .v{N} per CorpusStore.
	if (source_type === "paste") return "paste.md";
	if (source_type === "pdf") return "pdf.md";
	if (source_type === "linkedin") return "linkedin.md";
	if (source_type === "github") return "github.md";
	if (source_type === "url-snapshot") return `url-snapshot-${randomBytes(4).toString("hex")}.md`;
	return `${source_type}.md`;
}

// Translates a corpus_metadata row to a DocumentEvidence pointing at the raw
// artifact in evidence-store. The published claim's evidence MUST point at the
// raw artifact, never at the corpus markdown — per #15's hard privacy
// boundary.
function buildRawArtifactEvidence(meta: CorpusMetadata): DocumentEvidence {
	return {
		type: "document",
		document_url: meta.raw_storage_ref ?? `cairn://evidence/missing-${meta.path}-v${meta.version}`,
		content_hash: meta.raw_content_hash ?? "sha256:unknown",
		media_type: meta.raw_media_type ?? "application/octet-stream",
		label: `${meta.source_type} (corpus v${meta.version})`,
		uploaded_at: meta.fetched_at,
	};
}

function validateOrFallback(d: DraftInput): {
	type: string;
	value: Record<string, unknown>;
	visibility?: DraftInput["visibility"];
	source?: string;
} {
	const validator = getValueValidator(d.type);
	if (!validator) {
		// Unknown type — pass through (custom x: types are #6.3 territory and
		// admin/claims.ts rejects them at publish-create anyway).
		return { type: d.type, value: d.value, visibility: d.visibility };
	}
	const result = validator.safeParse(d.value);
	if (result.success) {
		return { type: d.type, value: d.value, visibility: d.visibility };
	}
	// Fall back to a `narrative` wrapper preserving the extracted text. The
	// candidate sees the raw text in the review queue and can fix or drop it
	// — better than silently dropping a draft that didn't fit the schema.
	const text = stringify(d.value);
	return {
		type: "narrative",
		value: { text, scope: `${d.type}_validation_fallback` },
		visibility: d.visibility,
	};
}

function stringify(value: Record<string, unknown>): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
