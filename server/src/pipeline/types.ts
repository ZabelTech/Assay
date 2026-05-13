// #15 shared types for the import pipeline + structurer + verifier surfaces.
// Lives here (not in domain/) because these are pipeline-internal — they describe
// drafts and corpus pointers, not the served Claim model.
import type { Visibility } from "../domain/types.js";

// A read-only handle a structurer can use to reference a corpus file at the
// version it actually inspected. Pinning the version means review-time display
// matches what the structurer saw even after later re-imports bump versions.
export interface CorpusOrigin {
	path: string;
	version: number;
}

export interface CorpusFile {
	path: string;
	version: number;
	frontmatter: CorpusFrontmatter;
	body: string;
}

export interface CorpusFrontmatter {
	source_type: string;
	source_url: string | null;
	fetched_at: string;
	content_hash: string;
}

export interface CorpusListEntry {
	path: string;
	version: number;
	source_type: string;
}

export interface CorpusReader {
	list(): CorpusListEntry[];
	read(path: string, version?: number): CorpusFile;
}

// The text the candidate provides to steer this extraction run. Free text, role
// hint, industry hint, goal — all optional, mixed-and-matched. Not persisted on
// the candidate's account; per-run only.
export interface Target {
	free_text?: string;
	role?: string;
	industry?: string;
	goal?: string;
}

// A draft claim the structurer emits. The pipeline persists this into the
// existing claim_drafts table (#7) but augments it with the origin pointer so
// publish can verify provenance and rewrite evidence to point at raw
// artifacts.
export interface DraftInput {
	type: string;
	value: Record<string, unknown>;
	visibility?: Visibility;
	origin: CorpusOrigin[];
}

// A pending wiki proposal the structurer surfaces when it sees a target gap.
// Lives in the same StructureResult so the pipeline can persist it into the
// pending_wiki_proposals table (from #17) alongside the run's drafts.
export interface WikiProposalDraft {
	kind: "role" | "skill" | "industry";
	slug: string;
	markdown: string;
}

export type ConflictContender =
	| { kind: "draft"; draft: DraftInput }
	| { kind: "published"; claim_id: string };

export interface ConflictRecord {
	contenders: ConflictContender[]; // at least two
	rationale: string;
}

export interface StructureResult {
	drafts: DraftInput[];
	conflicts: ConflictRecord[];
	wiki_proposals?: WikiProposalDraft[];
}
