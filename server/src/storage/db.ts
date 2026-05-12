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
	consumed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_tokens (
	token_hash TEXT PRIMARY KEY,
	created_at TEXT NOT NULL,
	revoked INTEGER NOT NULL DEFAULT 0
);
`;

export function openDatabase(path: string): DB {
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.exec(SCHEMA);
	return db;
}
