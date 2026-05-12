// #7 evidence storage abstraction. Uploaded evidence (document / image / screenshot) lives
// in a server-managed store; URL evidence (§8.2) is a reference only and bypasses this.
//
// For v0, a local-filesystem impl ships alongside an in-memory impl for tests. The store
// returns a stable `stored_url` (e.g. `cairn://evidence/<key>`) plus the SHA-256 content
// hash; the claim's evidence object records both. Per §8.3/§8.5 the hash provides integrity,
// not authenticity.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PutResult {
	stored_url: string;
	content_hash: string;
	byte_size: number;
}

export interface EvidenceStore {
	put(buffer: Buffer, mediaType: string): PutResult;
	get(storedUrl: string): Buffer | undefined;
	delete(storedUrl: string): void;
}

export class MemoryEvidenceStore implements EvidenceStore {
	private store = new Map<string, { bytes: Buffer; mediaType: string }>();

	put(buffer: Buffer, mediaType: string): PutResult {
		const key = randomBytes(8).toString("hex");
		const stored_url = `cairn://evidence/${key}`;
		this.store.set(stored_url, { bytes: buffer, mediaType });
		return {
			stored_url,
			content_hash: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
			byte_size: buffer.byteLength,
		};
	}

	get(storedUrl: string): Buffer | undefined {
		return this.store.get(storedUrl)?.bytes;
	}

	delete(storedUrl: string): void {
		this.store.delete(storedUrl);
	}
}

export class LocalEvidenceStore implements EvidenceStore {
	constructor(private dir: string) {
		mkdirSync(dir, { recursive: true });
	}

	put(buffer: Buffer, _mediaType: string): PutResult {
		const key = randomBytes(8).toString("hex");
		const stored_url = `cairn://evidence/${key}`;
		writeFileSync(join(this.dir, key), buffer);
		return {
			stored_url,
			content_hash: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
			byte_size: buffer.byteLength,
		};
	}

	get(storedUrl: string): Buffer | undefined {
		const key = storedUrl.replace("cairn://evidence/", "");
		try {
			return readFileSync(join(this.dir, key));
		} catch {
			return undefined;
		}
	}

	delete(storedUrl: string): void {
		const key = storedUrl.replace("cairn://evidence/", "");
		try {
			unlinkSync(join(this.dir, key));
		} catch {
			// idempotent
		}
	}
}
