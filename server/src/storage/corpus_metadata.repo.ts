// #15 corpus metadata. The filesystem stores per-subject markdown corpus files
// (under `candidate-corpus/{subject}/sources/<slug>.v<N>.md`); SQLite is the
// authoritative record of versions, content hashes, and the raw-artifact
// pointer each corpus file is paired with.
import type { Database } from "better-sqlite3";

export interface CorpusMetadata {
	subject: string;
	path: string; // logical path within the subject's sources/ dir
	version: number;
	source_type: string;
	source_url: string | null;
	fetched_at: string;
	content_hash: string; // sha256 of the normalized markdown body
	raw_storage_ref: string | null; // evidence-store key for the raw artifact
	raw_content_hash: string | null;
	raw_media_type: string | null;
}

export class CorpusMetadataRepo {
	constructor(private db: Database) {}

	insert(row: CorpusMetadata): void {
		this.db
			.prepare(
				`INSERT INTO corpus_metadata
				 (subject, path, version, source_type, source_url, fetched_at, content_hash,
				  raw_storage_ref, raw_content_hash, raw_media_type)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				row.subject,
				row.path,
				row.version,
				row.source_type,
				row.source_url,
				row.fetched_at,
				row.content_hash,
				row.raw_storage_ref,
				row.raw_content_hash,
				row.raw_media_type,
			);
	}

	// Returns the latest version of a corpus file. Used by the pipeline when
	// deciding whether to bump the version on re-import (compare content_hash).
	getLatest(subject: string, path: string): CorpusMetadata | undefined {
		const row = this.db
			.prepare(
				`SELECT * FROM corpus_metadata WHERE subject = ? AND path = ?
				 ORDER BY version DESC LIMIT 1`,
			)
			.get(subject, path) as CorpusMetadata | undefined;
		return row ?? undefined;
	}

	// Returns a specific version. Used at publish time to resolve the pinned
	// origin.version on a draft to the raw artifact stored when that version
	// was ingested.
	getVersion(subject: string, path: string, version: number): CorpusMetadata | undefined {
		const row = this.db
			.prepare(`SELECT * FROM corpus_metadata WHERE subject = ? AND path = ? AND version = ?`)
			.get(subject, path, version) as CorpusMetadata | undefined;
		return row ?? undefined;
	}

	// Returns the latest version of every corpus file for the subject. Used
	// by the CorpusReader.list() seen by the structurer.
	listLatest(subject: string): CorpusMetadata[] {
		return this.db
			.prepare(
				`SELECT m.* FROM corpus_metadata m
				 JOIN (
				   SELECT path, MAX(version) AS max_version FROM corpus_metadata
				   WHERE subject = ?
				   GROUP BY path
				 ) latest
				 ON m.path = latest.path AND m.version = latest.max_version
				 WHERE m.subject = ?
				 ORDER BY m.path`,
			)
			.all(subject, subject) as CorpusMetadata[];
	}

	// Used by the re-import contradiction check to find prior published claims
	// from corpus files of the same source_type — see pipeline/contradiction.ts.
	listBySourceType(subject: string, source_type: string): CorpusMetadata[] {
		return this.db
			.prepare(
				`SELECT * FROM corpus_metadata WHERE subject = ? AND source_type = ?
				 ORDER BY path, version`,
			)
			.all(subject, source_type) as CorpusMetadata[];
	}
}
