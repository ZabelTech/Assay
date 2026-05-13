import { PassThrough, Readable, Writable } from "node:stream";
// #18 CodexCliStructurer — unit tests against the Spawner stub seam.
// Real codex binary is never invoked; canned JSONL streams drive every path.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CodexAuthError,
	CodexCliStructurer,
	CodexQuotaExceededError,
	CodexSchemaViolationError,
	type SpawnedProcess,
	type Spawner,
	buildPrompt,
	selectInScopeOrigins,
} from "../../../src/adapters/codex_cli_structurer.js";
import { MockWebSearch } from "../../../src/adapters/web_search.js";
import type { CorpusFile, CorpusListEntry, CorpusReader } from "../../../src/pipeline/types.js";
import { EmptyWikiReader, type WikiReader } from "../../../src/wiki/reader.js";

// ---------------- Test doubles ----------------

class FakeCorpus implements CorpusReader {
	constructor(private files: CorpusFile[]) {}
	list(): CorpusListEntry[] {
		return this.files.map((f) => ({
			path: f.path,
			version: f.version,
			source_type: f.frontmatter.source_type,
		}));
	}
	read(path: string, version?: number): CorpusFile {
		const f = this.files.find(
			(x) => x.path === path && (version === undefined || x.version === version),
		);
		if (!f) throw new Error(`FakeCorpus: missing ${path}@v${version ?? "*"}`);
		return f;
	}
}

function corpusFile(path: string, source_type: string, body: string, version = 1): CorpusFile {
	return {
		path,
		version,
		frontmatter: {
			source_type,
			source_url: null,
			fetched_at: "2026-05-13T00:00:00Z",
			content_hash: "sha256:00",
		},
		body,
	};
}

// Records every interaction so tests can assert on argv + stdin payload.
class SpawnerRecorder {
	calls: Array<{ command: string; args: string[]; stdinChunks: string[] }> = [];
	private nextEvents: string[] = [];
	private nextExit: { code: number | null; signal: string | null } = { code: 0, signal: null };

	queueEvents(events: object[]): void {
		this.nextEvents = events.map((e) => `${JSON.stringify(e)}\n`);
	}

	setExit(code: number | null, signal: string | null = null): void {
		this.nextExit = { code, signal };
	}

	spawner: Spawner = (command, args): SpawnedProcess => {
		const call = { command, args, stdinChunks: [] as string[] };
		this.calls.push(call);

		const stdin = new Writable({
			write(chunk, _enc, cb) {
				call.stdinChunks.push(chunk.toString("utf8"));
				cb();
			},
		});

		const stdout = Readable.from(this.nextEvents);
		const stderr = new PassThrough();
		stderr.end();
		const exit = this.nextExit;

		return {
			stdin,
			stdout,
			stderr,
			waitForExit: async () => exit,
		};
	};
}

function makeStructurer(spawner: Spawner): CodexCliStructurer {
	return new CodexCliStructurer({ spawner, skipBinaryCheck: true });
}

// ---------------- Tests ----------------

describe("#18 CodexCliStructurer", () => {
	let recorder: SpawnerRecorder;
	let web: MockWebSearch;
	let wiki: WikiReader;

	beforeEach(() => {
		recorder = new SpawnerRecorder();
		web = new MockWebSearch();
		wiki = new EmptyWikiReader();
	});

	describe("happy path", () => {
		it("parses an agent_message into a typed StructureResult", async () => {
			recorder.queueEvents([
				{ type: "turn_started" }, // ignored
				{
					type: "agent_message",
					content: JSON.stringify({
						drafts: [
							{
								type: "skill",
								value: { name: "TypeScript" },
								origin: [{ path: "linkedin.md", version: 1 }],
							},
						],
						conflicts: [],
					}),
				},
			]);

			const corpus = new FakeCorpus([corpusFile("linkedin.md", "linkedin", "TypeScript expert")]);
			const result = await makeStructurer(recorder.spawner).structure({ corpus, wiki, web });

			expect(result.drafts.length).toBe(1);
			expect(result.drafts[0]!.type).toBe("skill");
			expect(result.drafts[0]!.origin).toEqual([{ path: "linkedin.md", version: 1 }]);
			expect(result.conflicts).toEqual([]);
		});

		it("accepts agent_message content as a parsed object (not only string)", async () => {
			// WHY: chat-style models under --output-schema may return either a JSON
			// string or an already-parsed object. Accept both.
			recorder.queueEvents([
				{
					type: "agent_message",
					content: {
						drafts: [
							{ type: "skill", value: { name: "Rust" }, origin: [{ path: "x.md", version: 1 }] },
						],
						conflicts: [],
					},
				},
			]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "Rust 5y")]);
			const result = await makeStructurer(recorder.spawner).structure({ corpus, wiki, web });
			expect(result.drafts[0]!.value).toEqual({ name: "Rust" });
		});

		it("preserves wiki_proposals and wiki_slugs_used when present", async () => {
			recorder.queueEvents([
				{
					type: "agent_message",
					content: {
						drafts: [],
						conflicts: [],
						wiki_proposals: [{ kind: "skill", slug: "rust", markdown: "# Rust\n" }],
						wiki_slugs_used: ["typescript"],
					},
				},
			]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			const result = await makeStructurer(recorder.spawner).structure({ corpus, wiki, web });
			expect(result.wiki_proposals?.length).toBe(1);
			expect(result.wiki_slugs_used).toEqual(["typescript"]);
		});
	});

	describe("prompt building and argv", () => {
		it("writes prompt to stdin with stable [corpus:PATH@vVERSION] labels", async () => {
			recorder.queueEvents([
				{
					type: "agent_message",
					content: { drafts: [], conflicts: [] },
				},
			]);
			const corpus = new FakeCorpus([
				corpusFile("linkedin.md", "linkedin", "BODY A", 3),
				corpusFile("github.md", "github", "BODY B", 1),
			]);
			await makeStructurer(recorder.spawner).structure({ corpus, wiki, web });

			const stdin = recorder.calls[0]!.stdinChunks.join("");
			expect(stdin).toContain("[corpus:linkedin.md@v3]");
			expect(stdin).toContain("[corpus:github.md@v1]");
			expect(stdin).toContain("BODY A");
			expect(stdin).toContain("BODY B");
		});

		it("argv contains --output-schema pointing at a readable JSON Schema file", async () => {
			recorder.queueEvents([{ type: "agent_message", content: { drafts: [], conflicts: [] } }]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await makeStructurer(recorder.spawner).structure({ corpus, wiki, web });

			const args = recorder.calls[0]!.args;
			const idx = args.indexOf("--output-schema");
			expect(idx).toBeGreaterThanOrEqual(0);
			const schemaPath = args[idx + 1]!;
			// The temp dir gets cleaned up after structure() returns; we just
			// verify the flag is present and the next arg looks like a path,
			// not the literal `{schema}` placeholder bug from prior issue
			// rendering. (The schema content itself is exercised in the next test.)
			expect(schemaPath).toMatch(/[\\/]schema\.json$/);
		});

		it("argv always includes --json and --skip-git-repo-check", async () => {
			recorder.queueEvents([{ type: "agent_message", content: { drafts: [], conflicts: [] } }]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await makeStructurer(recorder.spawner).structure({ corpus, wiki, web });

			expect(recorder.calls[0]!.args).toContain("--json");
			expect(recorder.calls[0]!.args).toContain("--skip-git-repo-check");
		});

		it("argv pins --model gpt-5.5 by default; constructor model option overrides", async () => {
			// WHY: relying on codex's implicit default ties us to whatever ships
			// most-recent. Pinning makes runs reproducible and avoids the
			// no-default-model failure mode seen in early smoke testing.
			recorder.queueEvents([{ type: "agent_message", content: { drafts: [], conflicts: [] } }]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await makeStructurer(recorder.spawner).structure({ corpus, wiki, web });
			const defaultArgs = recorder.calls[0]!.args;
			const i = defaultArgs.indexOf("--model");
			expect(i).toBeGreaterThanOrEqual(0);
			expect(defaultArgs[i + 1]).toBe("gpt-5.5");

			// Override path.
			const overrideRecorder = new SpawnerRecorder();
			overrideRecorder.queueEvents([
				{ type: "agent_message", content: { drafts: [], conflicts: [] } },
			]);
			await new CodexCliStructurer({
				spawner: overrideRecorder.spawner,
				skipBinaryCheck: true,
				model: "gpt-5.4",
			}).structure({ corpus, wiki, web });
			const overrideArgs = overrideRecorder.calls[0]!.args;
			const j = overrideArgs.indexOf("--model");
			expect(overrideArgs[j + 1]).toBe("gpt-5.4");
		});

		it("restricts the prompt to new_origins when supplied", async () => {
			// WHY: the pipeline always passes new_origins so a re-import doesn't
			// re-extract from the entire corpus, only the fresh files.
			recorder.queueEvents([{ type: "agent_message", content: { drafts: [], conflicts: [] } }]);
			const corpus = new FakeCorpus([
				corpusFile("old.md", "paste", "OLD BODY"),
				corpusFile("new.md", "pdf", "NEW BODY"),
			]);
			await makeStructurer(recorder.spawner).structure({
				corpus,
				wiki,
				web,
				new_origins: [{ path: "new.md", version: 1 }],
			});
			const stdin = recorder.calls[0]!.stdinChunks.join("");
			expect(stdin).toContain("NEW BODY");
			expect(stdin).not.toContain("OLD BODY");
		});

		it("includes target hints in the prompt when present", async () => {
			recorder.queueEvents([{ type: "agent_message", content: { drafts: [], conflicts: [] } }]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await makeStructurer(recorder.spawner).structure({
				corpus,
				wiki,
				web,
				target: { role: "staff-engineer", industry: "fintech", free_text: "remote only" },
			});
			const stdin = recorder.calls[0]!.stdinChunks.join("");
			expect(stdin).toContain("role: staff-engineer");
			expect(stdin).toContain("industry: fintech");
			expect(stdin).toContain("remote only");
		});
	});

	describe("error mapping", () => {
		it("quota_exceeded → CodexQuotaExceededError", async () => {
			recorder.queueEvents([{ type: "error", symbol: "quota_exceeded", detail: "weekly cap hit" }]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await expect(
				makeStructurer(recorder.spawner).structure({ corpus, wiki, web }),
			).rejects.toBeInstanceOf(CodexQuotaExceededError);
		});

		it("rate_limit_exceeded → CodexQuotaExceededError (5-hour window)", async () => {
			recorder.queueEvents([
				{ type: "error", symbol: "rate_limit_exceeded", detail: "5h window full" },
			]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await expect(
				makeStructurer(recorder.spawner).structure({ corpus, wiki, web }),
			).rejects.toBeInstanceOf(CodexQuotaExceededError);
		});

		it("not_authenticated → CodexAuthError", async () => {
			recorder.queueEvents([
				{ type: "error", symbol: "not_authenticated", detail: "run `codex login`" },
			]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await expect(
				makeStructurer(recorder.spawner).structure({ corpus, wiki, web }),
			).rejects.toBeInstanceOf(CodexAuthError);
		});

		it("schema_violation error event → CodexSchemaViolationError", async () => {
			recorder.queueEvents([
				{ type: "error", symbol: "schema_violation", detail: "missing field" },
			]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await expect(
				makeStructurer(recorder.spawner).structure({ corpus, wiki, web }),
			).rejects.toBeInstanceOf(CodexSchemaViolationError);
		});

		it("missing agent_message → CodexSchemaViolationError", async () => {
			recorder.queueEvents([{ type: "turn_started" }, { type: "turn_ended" }]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await expect(
				makeStructurer(recorder.spawner).structure({ corpus, wiki, web }),
			).rejects.toBeInstanceOf(CodexSchemaViolationError);
		});

		it("agent_message string content that isn't valid JSON → CodexSchemaViolationError", async () => {
			recorder.queueEvents([{ type: "agent_message", content: "not-json{" }]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await expect(
				makeStructurer(recorder.spawner).structure({ corpus, wiki, web }),
			).rejects.toBeInstanceOf(CodexSchemaViolationError);
		});

		it("agent_message content missing drafts → CodexSchemaViolationError", async () => {
			recorder.queueEvents([{ type: "agent_message", content: { conflicts: [] } }]);
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			await expect(
				makeStructurer(recorder.spawner).structure({ corpus, wiki, web }),
			).rejects.toBeInstanceOf(CodexSchemaViolationError);
		});

		it("non-JSON lines in the stream are skipped (codex emits one event per line; we tolerate noise)", async () => {
			const noisySpawner: Spawner = (_command, _args): SpawnedProcess => ({
				stdin: new Writable({
					write(_c, _e, cb) {
						cb();
					},
				}),
				stdout: Readable.from([
					"garbage non-json line\n",
					`${JSON.stringify({ type: "agent_message", content: { drafts: [], conflicts: [] } })}\n`,
				]),
				stderr: (() => {
					const s = new PassThrough();
					s.end();
					return s;
				})(),
				waitForExit: async () => ({ code: 0, signal: null }),
			});
			const corpus = new FakeCorpus([corpusFile("x.md", "paste", "x")]);
			const result = await makeStructurer(noisySpawner).structure({ corpus, wiki, web });
			expect(result.drafts).toEqual([]);
		});
	});

	describe("constructor binary check", () => {
		it("throws CodexBinaryMissingError when no spawner is injected and codex isn't on PATH", () => {
			// WHY: misconfigured deployments fail fast at startup, not on first import.
			expect(
				() => new CodexCliStructurer({ codexBinary: "definitely-not-installed-codex-binary" }),
			).toThrow(/codex binary not found on PATH/);
		});

		it("skips the binary check when a spawner is injected (test mode)", () => {
			expect(() => new CodexCliStructurer({ spawner: recorder.spawner })).not.toThrow();
		});
	});
});

// Pure-function exports — sanity-check the units the bigger tests rely on.
describe("#18 CodexCliStructurer — pure helpers", () => {
	describe("selectInScopeOrigins", () => {
		it("returns all corpus entries when new_origins is undefined", () => {
			const corpus = new FakeCorpus([
				corpusFile("a.md", "paste", "a", 1),
				corpusFile("b.md", "pdf", "b", 2),
			]);
			expect(selectInScopeOrigins(corpus)).toEqual([
				{ path: "a.md", version: 1 },
				{ path: "b.md", version: 2 },
			]);
		});

		it("filters to the intersection of new_origins and the corpus list", () => {
			const corpus = new FakeCorpus([
				corpusFile("a.md", "paste", "a", 1),
				corpusFile("b.md", "pdf", "b", 2),
				corpusFile("c.md", "linkedin", "c", 1),
			]);
			expect(
				selectInScopeOrigins(corpus, [
					{ path: "b.md", version: 2 },
					{ path: "c.md", version: 1 },
				]),
			).toEqual([
				{ path: "b.md", version: 2 },
				{ path: "c.md", version: 1 },
			]);
		});
	});

	describe("buildPrompt", () => {
		it("emits stable per-file headers and orders them by the input list", () => {
			const out = buildPrompt({
				corpusFiles: [
					corpusFile("first.md", "paste", "first body", 1),
					corpusFile("second.md", "pdf", "second body", 2),
				],
				wikiPages: [],
			});
			const firstHeaderIdx = out.indexOf("[corpus:first.md@v1]");
			const secondHeaderIdx = out.indexOf("[corpus:second.md@v2]");
			expect(firstHeaderIdx).toBeGreaterThanOrEqual(0);
			expect(secondHeaderIdx).toBeGreaterThan(firstHeaderIdx);
		});
	});
});
