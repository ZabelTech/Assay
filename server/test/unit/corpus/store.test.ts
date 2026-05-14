// CorpusStore path-traversal guard.
//
// The structurer is fed candidate-uploaded content and emits origin paths that
// reach the corpus store. A successful prompt-injection that nudges the
// structurer to emit a path like `linkedin/../../etc/cairn.db` MUST NOT be
// allowed to escape the per-subject sources/ sandbox.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorpusStore, assertSafeCorpusPath } from "../../../src/corpus/store.js";

let rootDir: string;
let store: CorpusStore;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "assay-corpus-store-test-"));
	store = new CorpusStore(rootDir);
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("assertSafeCorpusPath", () => {
	it("accepts the path shapes the pipeline emits today", () => {
		// WHY: the pipeline writes `paste.md`, `linkedin.md`, `linkedin/articles/foo.md`,
		// `url-snapshot-<hex>.md`, etc. The guard must not break the happy path.
		expect(() => assertSafeCorpusPath("paste.md")).not.toThrow();
		expect(() => assertSafeCorpusPath("linkedin.md")).not.toThrow();
		expect(() => assertSafeCorpusPath("linkedin/articles/foo.md")).not.toThrow();
		expect(() => assertSafeCorpusPath("github/repos/owner-name.md")).not.toThrow();
		expect(() => assertSafeCorpusPath("url-snapshot-abcd1234.md")).not.toThrow();
	});

	it("rejects traversal segments", () => {
		// WHY: this is the whole point of the guard. `..` in any segment escapes the
		// per-subject sources/ sandbox under join().
		expect(() => assertSafeCorpusPath("../etc/passwd.md")).toThrow(/forbidden segment/);
		expect(() => assertSafeCorpusPath("linkedin/../../etc/passwd.md")).toThrow(/forbidden segment/);
		expect(() => assertSafeCorpusPath("foo/./bar.md")).toThrow(/forbidden segment/);
	});

	it("rejects absolute paths", () => {
		// WHY: an absolute path passed to join() with the rootDir prefix would still
		// resolve relative to rootDir on POSIX (join("/data", "/etc/passwd") ===
		// "/data/etc/passwd"), but treating an absolute-looking path as a corpus
		// path is itself a bug — fail loud.
		expect(() => assertSafeCorpusPath("/etc/passwd.md")).toThrow(/relative/);
		expect(() => assertSafeCorpusPath("\\windows\\system32.md")).toThrow(/relative/);
		expect(() => assertSafeCorpusPath("C:/Users/foo.md")).toThrow(/relative/);
	});

	it("rejects NUL bytes and empty strings", () => {
		expect(() => assertSafeCorpusPath("foo\0bar.md")).toThrow(/NUL/);
		expect(() => assertSafeCorpusPath("")).toThrow(/non-empty/);
	});

	it("rejects empty path segments produced by leading/double slashes", () => {
		expect(() => assertSafeCorpusPath("foo//bar.md")).toThrow(/forbidden segment/);
	});
});

describe("CorpusStore traversal containment", () => {
	it("resolveOnDisk throws before computing an escaping on-disk path", () => {
		expect(() => store.resolveOnDisk("alice@example.com", "../../etc/passwd.md", 1)).toThrow();
	});

	it("writeVersion refuses to write outside the per-subject sources/ tree", async () => {
		// WHY: this is the load-bearing assertion — confirming the guard is wired at the
		// write boundary, not only in the resolver helper.
		await expect(
			store.writeVersion({
				subject: "alice@example.com",
				path: "linkedin/../../escape.md",
				version: 1,
				frontmatter: {
					source_type: "linkedin",
					source_url: null,
					fetched_at: new Date().toISOString(),
					content_hash: "sha256:" + "0".repeat(64),
				},
				body: "should never be written",
			}),
		).rejects.toThrow(/forbidden segment/);
	});
});
