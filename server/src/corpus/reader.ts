// #15 CorpusReader — the read-only view the structurer sees. Backed by
// CorpusMetadata (the SQLite source of truth for versions + frontmatter) and
// the CorpusStore (the on-disk markdown body).
//
// list() returns the latest version of every corpus file for the subject;
// read(path, version) resolves a pinned origin pointer. The structurer
// shouldn't need to know the version most of the time — it lists, picks files,
// and the version it observed comes back attached to each entry. Pinning is
// handled by the pipeline downstream.
import type { CorpusFile, CorpusListEntry, CorpusReader } from "../pipeline/types.js";
import type { CorpusMetadataRepo } from "../storage/corpus_metadata.repo.js";
import type { CorpusStore } from "./store.js";

export class FsCorpusReader implements CorpusReader {
	constructor(
		private readonly subject: string,
		private readonly metadata: CorpusMetadataRepo,
		private readonly store: CorpusStore,
	) {}

	list(): CorpusListEntry[] {
		return this.metadata.listLatest(this.subject).map((m) => ({
			path: m.path,
			version: m.version,
			source_type: m.source_type,
		}));
	}

	read(path: string, version?: number): CorpusFile {
		const v = version ?? this.metadata.getLatest(this.subject, path)?.version;
		if (v === undefined) throw new Error(`corpus file not found: ${path}`);
		// Sync wrapper — the structurer's interface is synchronous on read for
		// ergonomics (it'll loop through files), but the store is async. We use
		// the synchronous SQLite metadata and an internal cache populated by
		// the pipeline at ingest time.
		const cached = this.cache.get(this.cacheKey(path, v));
		if (cached) return cached;
		throw new Error(`corpus file not cached: ${path} v${v} — read() called outside an ingest run`);
	}

	// Internal cache populated by the pipeline at ingest time. The structurer
	// runs inside one ingest call; by the time we hand it the reader, every
	// file it could ask for has already been written. We pre-load them so the
	// CorpusReader.read() can stay synchronous (matches the spec'd interface).
	private cache = new Map<string, CorpusFile>();

	primeCache(file: CorpusFile): void {
		this.cache.set(this.cacheKey(file.path, file.version), file);
	}

	private cacheKey(path: string, version: number): string {
		return `${path}::${version}`;
	}
}

// Helper used by the pipeline to construct a primed reader for a run. The
// returned reader sees every file that exists in metadata for the subject,
// with bodies pre-loaded so read() is synchronous.
export async function buildPrimedCorpusReader(
	subject: string,
	metadata: CorpusMetadataRepo,
	store: CorpusStore,
): Promise<FsCorpusReader> {
	const reader = new FsCorpusReader(subject, metadata, store);
	for (const m of metadata.listLatest(subject)) {
		const file = await store.readVersion({ subject, path: m.path, version: m.version });
		reader.primeCache(file);
	}
	return reader;
}
