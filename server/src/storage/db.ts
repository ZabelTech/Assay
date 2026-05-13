// SQLite initializer + migration. Single embedded SQL string; idempotent.
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS claims (
	claim_id TEXT PRIMARY KEY,
	subject TEXT NOT NULL,
	type TEXT NOT NULL,
	visibility TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	body TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_created ON claims (created_at, claim_id);
CREATE INDEX IF NOT EXISTS idx_claims_type ON claims (type);
CREATE INDEX IF NOT EXISTS idx_claims_visibility ON claims (visibility);

CREATE TABLE IF NOT EXISTS tokens (
	token_id TEXT PRIMARY KEY,
	token_hash TEXT NOT NULL UNIQUE,
	expires_at TEXT NOT NULL,
	audience_hint TEXT,
	purpose TEXT,
	revoked INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
	rowid INTEGER PRIMARY KEY AUTOINCREMENT,
	request_id TEXT NOT NULL,
	token_id TEXT,
	audience_hint TEXT,
	purpose TEXT,
	timestamp TEXT NOT NULL,
	tool TEXT NOT NULL,
	claim_ids_returned TEXT NOT NULL,
	claim_ids_consulted TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
	email TEXT PRIMARY KEY,
	verified INTEGER NOT NULL DEFAULT 0,
	verified_at TEXT,
	challenge_method TEXT
);

CREATE TABLE IF NOT EXISTS subject_challenges (
	challenge TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	method TEXT NOT NULL,
	code TEXT,
	created_at TEXT NOT NULL,
	consumed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS endorsement_challenges (
	challenge TEXT PRIMARY KEY,
	endorser_email TEXT NOT NULL,
	endorser_name TEXT,
	value_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	consumed INTEGER NOT NULL DEFAULT 0,
	solicitation_id TEXT,
	solicited_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_endorsement_solicitation ON endorsement_challenges (solicitation_id);

CREATE TABLE IF NOT EXISTS admin_tokens (
	token_hash TEXT PRIMARY KEY,
	created_at TEXT NOT NULL,
	revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS current_subject (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS handles (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	handle TEXT NOT NULL,
	set_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_drafts (
	draft_id TEXT PRIMARY KEY,
	source TEXT NOT NULL,
	type TEXT NOT NULL,
	visibility TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_wiki_proposals (
	proposal_id TEXT PRIMARY KEY,
	kind TEXT NOT NULL CHECK (kind IN ('role', 'skill', 'industry')),
	slug TEXT NOT NULL,
	markdown TEXT NOT NULL,
	target TEXT,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_wiki_proposals_slug ON pending_wiki_proposals (slug);

-- #15 corpus metadata. Authoritative record of versions, hashes, and the raw
-- artifact pointer for each on-disk markdown file the structurer reads.
CREATE TABLE IF NOT EXISTS corpus_metadata (
	subject TEXT NOT NULL,
	path TEXT NOT NULL,
	version INTEGER NOT NULL,
	source_type TEXT NOT NULL,
	source_url TEXT,
	fetched_at TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	raw_storage_ref TEXT,
	raw_content_hash TEXT,
	raw_media_type TEXT,
	PRIMARY KEY (subject, path, version)
);

CREATE INDEX IF NOT EXISTS idx_corpus_metadata_source_type ON corpus_metadata (subject, source_type);

-- #15 reconciliation queue. Conflict records produced by the structurer (same-
-- run cross-source) or the pipeline's deterministic re-import contradiction
-- detector. Resolved via merge / keep_both / edit / drop actions on the admin
-- API.
CREATE TABLE IF NOT EXISTS conflicts (
	conflict_id TEXT PRIMARY KEY,
	subject TEXT NOT NULL,
	rationale TEXT NOT NULL,
	contenders_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	resolved_at TEXT,
	resolution TEXT
);

-- #15 / #16 wiki page usage tracking. Records when a structurer run consumed
-- a wiki page that materially influenced a published claim. Stale-by-use
-- exemption logic is future work; the data hook ships in v0.
CREATE TABLE IF NOT EXISTS wiki_page_uses (
	slug TEXT NOT NULL,
	claim_id TEXT NOT NULL,
	used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_page_uses_slug ON wiki_page_uses (slug);
`;

export function openDatabase(path: string): DB {
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.exec(SCHEMA);
	return db;
}
