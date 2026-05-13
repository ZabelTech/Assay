// #18 Codex CLI structurer engine. Subprocesses OpenAI's `codex exec --json`
// so usage counts against a ChatGPT Plus/Pro/Business subscription quota
// instead of the OpenAI API per-token bill. Operator runs `codex login` once
// out-of-band; tokens persist in ~/.codex.
//
// Strictly an engine swap on the #15 Structurer interface. Pipeline /
// Verifier / corpus / wiki / conflicts are unchanged.
//
// Implementation is hand-rolled subprocess + JSONL parser rather than an
// OpenAI-published TypeScript SDK to keep the dependency surface minimal and
// avoid the package-naming churn of an early-stage tool. The JSONL contract
// from `codex exec --json` is stable per OpenAI's docs; the parser tolerates
// unknown event types.

import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type {
	CorpusFile,
	CorpusListEntry,
	CorpusOrigin,
	CorpusReader,
	DraftInput,
	StructureResult,
	Target,
	WikiProposalDraft,
} from "../pipeline/types.js";
import type { WikiReader } from "../wiki/reader.js";
import type { Structurer } from "./structurer.js";
import type { WebSearch } from "./web_search.js";

// ---------------- Typed errors ----------------

export class CodexBinaryMissingError extends Error {
	constructor(binary: string) {
		super(`codex binary not found on PATH: ${binary}`);
		this.name = "CodexBinaryMissingError";
	}
}

export class CodexAuthError extends Error {
	constructor(detail: string) {
		super(`codex not signed in (or token refresh failed): ${detail}`);
		this.name = "CodexAuthError";
	}
}

export class CodexQuotaExceededError extends Error {
	constructor(detail: string) {
		super(`codex subscription quota exceeded: ${detail}`);
		this.name = "CodexQuotaExceededError";
	}
}

export class CodexSchemaViolationError extends Error {
	constructor(detail: string) {
		super(`codex agent_message did not match the StructureResult schema: ${detail}`);
		this.name = "CodexSchemaViolationError";
	}
}

// ---------------- Spawner test seam ----------------

// Minimal shape of a spawned process this module needs. Real implementation
// is `child_process.spawn`; tests pass a stub that returns canned streams.
// Designed so callers can pipe to stdin (prompt) and read line-delimited
// JSONL from stdout, with an exit promise to know when to stop.
export interface SpawnedProcess {
	stdin: Writable;
	stdout: Readable;
	stderr: Readable;
	waitForExit(): Promise<{ code: number | null; signal: string | null }>;
}

export type Spawner = (command: string, args: string[]) => SpawnedProcess;

const defaultSpawner: Spawner = (command, args) => {
	const child = nodeSpawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
	// stdio "pipe" on all three fds guarantees the streams are non-null; the
	// throw is defensive against future Node changes / corrupted spawn calls.
	if (!child.stdin || !child.stdout || !child.stderr) {
		throw new Error("codex spawn did not produce piped stdio streams");
	}
	const { stdin, stdout, stderr } = child;
	return {
		stdin,
		stdout,
		stderr,
		waitForExit: () =>
			new Promise((resolve) => {
				child.on("exit", (code, signal) => resolve({ code, signal }));
			}),
	};
};

// ---------------- Structurer impl ----------------

export interface CodexCliStructurerOptions {
	codexBinary?: string;
	model?: string;
	spawner?: Spawner;
	// Constructor binary-existence check is on by default; tests turn it off
	// because the spawner stub doesn't need a real binary on PATH.
	skipBinaryCheck?: boolean;
}

export class CodexCliStructurer implements Structurer {
	private readonly codexBinary: string;
	private readonly model: string | undefined;
	private readonly spawner: Spawner;

	constructor(opts: CodexCliStructurerOptions = {}) {
		this.codexBinary = opts.codexBinary ?? "codex";
		this.model = opts.model;
		this.spawner = opts.spawner ?? defaultSpawner;

		if (!opts.skipBinaryCheck && !opts.spawner) {
			// Fail fast at construction so misconfigured deployments surface in
			// startup, not on the first import attempt. Skipped when a spawner
			// is injected (tests).
			if (!findOnPath(this.codexBinary)) {
				throw new CodexBinaryMissingError(this.codexBinary);
			}
		}
	}

	async structure(input: {
		corpus: CorpusReader;
		wiki: WikiReader;
		web: WebSearch;
		target?: Target;
		new_origins?: CorpusOrigin[];
	}): Promise<StructureResult> {
		// Build the run inputs: which corpus files are in-scope, the prompt
		// body the model reads, and the JSON Schema constraining its output.
		const inScopeOrigins = selectInScopeOrigins(input.corpus, input.new_origins);
		const corpusFiles = inScopeOrigins.map((o) => input.corpus.read(o.path, o.version));
		const wikiPages = input.wiki.list().map((ref) => input.wiki.read(ref.slug));
		const prompt = buildPrompt({ corpusFiles, wikiPages, target: input.target });

		const tmpDir = mkdtempSync(join(tmpdir(), "codex-structurer-"));
		const schemaPath = join(tmpDir, "schema.json");
		writeFileSync(schemaPath, JSON.stringify(STRUCTURE_RESULT_SCHEMA, null, 2));

		try {
			const argv = [
				"exec",
				"--json",
				"--skip-git-repo-check",
				"--output-schema",
				schemaPath,
				...(this.model ? ["--model", this.model] : []),
			];
			const proc = this.spawner(this.codexBinary, argv);

			// Prompt content goes via stdin (never argv) — corpus content can
			// contain shell metachars or prompt-injection text, and stdin
			// sidesteps argv-length limits anyway.
			proc.stdin.write(prompt);
			proc.stdin.end();

			const result = await parseJsonlStream(proc.stdout);
			await proc.waitForExit();
			return result;
		} finally {
			try {
				rmSync(tmpDir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		}
	}
}

// ---------------- Prompt building ----------------

// Each in-scope corpus file is labelled with `[corpus:{path}@v{version}]`
// so the model has a stable string to cite back in DraftInput.origin.
export function buildPrompt(input: {
	corpusFiles: CorpusFile[];
	wikiPages: ReturnType<WikiReader["read"]>[];
	target?: Target;
}): string {
	const parts: string[] = [];
	parts.push(SYSTEM_PREAMBLE);

	if (input.target) {
		parts.push("# Target");
		if (input.target.role) parts.push(`role: ${input.target.role}`);
		if (input.target.industry) parts.push(`industry: ${input.target.industry}`);
		if (input.target.goal) parts.push(`goal: ${input.target.goal}`);
		if (input.target.free_text) parts.push(input.target.free_text);
	}

	parts.push("# Corpus");
	for (const f of input.corpusFiles) {
		parts.push(`## [corpus:${f.path}@v${f.version}]`);
		parts.push(`source_type: ${f.frontmatter.source_type}`);
		parts.push("");
		parts.push(f.body);
	}

	if (input.wikiPages.length > 0) {
		parts.push("# Wiki");
		for (const p of input.wikiPages) {
			parts.push(`## [wiki:${p.frontmatter.slug}]`);
			parts.push(`kind: ${p.frontmatter.kind}`);
			parts.push(`updated_at: ${p.frontmatter.updated_at}`);
			for (const s of p.sections) {
				parts.push(`### ${s.heading}`);
				parts.push(s.body);
			}
		}
	}

	return parts.join("\n\n");
}

const SYSTEM_PREAMBLE = `You are extracting Cairn-protocol claim drafts from a candidate's own
imported sources. Respond ONLY with a JSON document matching the supplied
JSON Schema (a StructureResult). Every draft you emit MUST:

- carry an "origin" array of {path, version} pointers into the supplied corpus
  files (use the exact strings shown in the [corpus:PATH@vVERSION] headers),
- contain only content that is supported by the cited corpus files (do not
  invent facts to match the target — surface what is there),
- use the candidate-supplied target (if any) to prioritize which claims are
  most relevant, not to fabricate.

Conflicting facts across sources go into the "conflicts" array as
ConflictRecord{contenders, rationale}; do not auto-merge.`;

// ---------------- In-scope filter ----------------

export function selectInScopeOrigins(
	corpus: CorpusReader,
	new_origins?: CorpusOrigin[],
): CorpusOrigin[] {
	const all = corpus.list();
	if (new_origins && new_origins.length > 0) {
		const keep = new Set(new_origins.map((o) => `${o.path}::${o.version}`));
		return all
			.filter((e) => keep.has(`${e.path}::${e.version}`))
			.map((e) => ({ path: e.path, version: e.version }));
	}
	return all.map((e: CorpusListEntry) => ({ path: e.path, version: e.version }));
}

// ---------------- JSON Schema for StructureResult ----------------

// Hand-rolled to avoid pulling in zod-to-json-schema. Mirrors
// pipeline/types.ts. Update both together if either changes.
const STRUCTURE_RESULT_SCHEMA = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	type: "object",
	required: ["drafts", "conflicts"],
	additionalProperties: false,
	properties: {
		drafts: {
			type: "array",
			items: {
				type: "object",
				required: ["type", "value", "origin"],
				properties: {
					type: { type: "string" },
					value: { type: "object" },
					visibility: { enum: ["public", "permissioned", "private"] },
					origin: {
						type: "array",
						minItems: 1,
						items: {
							type: "object",
							required: ["path", "version"],
							properties: {
								path: { type: "string" },
								version: { type: "integer" },
							},
						},
					},
				},
			},
		},
		conflicts: {
			type: "array",
			items: {
				type: "object",
				required: ["contenders", "rationale"],
				properties: {
					contenders: {
						type: "array",
						minItems: 2,
						items: {
							oneOf: [
								{
									type: "object",
									required: ["kind", "draft"],
									properties: { kind: { const: "draft" }, draft: { type: "object" } },
								},
								{
									type: "object",
									required: ["kind", "claim_id"],
									properties: { kind: { const: "published" }, claim_id: { type: "string" } },
								},
							],
						},
					},
					rationale: { type: "string" },
				},
			},
		},
		wiki_proposals: {
			type: "array",
			items: {
				type: "object",
				required: ["kind", "slug", "markdown"],
				properties: {
					kind: { enum: ["role", "skill", "industry"] },
					slug: { type: "string" },
					markdown: { type: "string" },
				},
			},
		},
		wiki_slugs_used: { type: "array", items: { type: "string" } },
	},
} as const;

// ---------------- JSONL parsing ----------------

// Codex `exec --json` emits a JSONL stream of events. The final
// `agent_message` carries the structured response (its `content` is the JSON
// document matching --output-schema). Error events with known symbols are
// mapped to typed errors. Unknown event types are skipped.
async function parseJsonlStream(stdout: Readable): Promise<StructureResult> {
	let agentMessage: unknown = undefined;
	for await (const line of readLines(stdout)) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		let event: { type?: string; content?: unknown; symbol?: string; detail?: string };
		try {
			event = JSON.parse(trimmed) as typeof event;
		} catch {
			// Mid-stream non-JSON noise is skipped; codex's JSONL contract
			// promises one event per line.
			continue;
		}
		if (event.type === "error") {
			throwTyped(event);
		}
		if (event.type === "agent_message") {
			agentMessage = event.content;
		}
		// All other event types (turn_started, tool_call, etc.) are ignored.
	}
	if (agentMessage === undefined) {
		throw new CodexSchemaViolationError("no agent_message event in JSONL stream");
	}
	return coerceStructureResult(agentMessage);
}

function throwTyped(event: { symbol?: string; detail?: string }): never {
	const detail = event.detail ?? event.symbol ?? "unknown error";
	switch (event.symbol) {
		case "quota_exceeded":
		case "rate_limit_exceeded":
			throw new CodexQuotaExceededError(detail);
		case "not_authenticated":
		case "auth_expired":
			throw new CodexAuthError(detail);
		case "schema_violation":
			throw new CodexSchemaViolationError(detail);
		default:
			throw new Error(`codex exec error: ${detail}`);
	}
}

function coerceStructureResult(raw: unknown): StructureResult {
	// `content` may arrive as a string (typical for chat-style models even
	// under --output-schema) or as a parsed object. Accept both.
	let value: unknown = raw;
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw);
		} catch {
			throw new CodexSchemaViolationError("agent_message content is not valid JSON");
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new CodexSchemaViolationError("agent_message content is not an object");
	}
	const obj = value as Record<string, unknown>;
	if (!Array.isArray(obj.drafts)) {
		throw new CodexSchemaViolationError("missing or invalid 'drafts' array");
	}
	if (!Array.isArray(obj.conflicts)) {
		throw new CodexSchemaViolationError("missing or invalid 'conflicts' array");
	}
	return {
		drafts: obj.drafts as DraftInput[],
		conflicts: obj.conflicts as StructureResult["conflicts"],
		wiki_proposals: Array.isArray(obj.wiki_proposals)
			? (obj.wiki_proposals as WikiProposalDraft[])
			: undefined,
		wiki_slugs_used: Array.isArray(obj.wiki_slugs_used)
			? (obj.wiki_slugs_used as string[])
			: undefined,
	};
}

async function* readLines(stream: Readable): AsyncGenerator<string> {
	let buffer = "";
	for await (const chunk of stream) {
		buffer += typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8");
		for (let idx = buffer.indexOf("\n"); idx >= 0; idx = buffer.indexOf("\n")) {
			yield buffer.slice(0, idx);
			buffer = buffer.slice(idx + 1);
		}
	}
	if (buffer.length > 0) yield buffer;
}

// ---------------- PATH lookup ----------------

function findOnPath(binary: string): boolean {
	const path = process.env.PATH ?? "";
	const sep = process.platform === "win32" ? ";" : ":";
	const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE").split(";") : [""];
	for (const dir of path.split(sep)) {
		for (const ext of exts) {
			if (existsSync(join(dir, binary + ext))) return true;
		}
	}
	return false;
}
