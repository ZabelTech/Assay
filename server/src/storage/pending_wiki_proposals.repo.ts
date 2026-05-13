// #17 pending wiki proposals. When #15's structurer identifies a target with no
// matching wiki page, the gap-filling path produces a draft new-page proposal.
// Proposals live here until the candidate Promotes (which calls WikiRepo and
// removes the row) or Dismisses (which removes the row). Ignored proposals stay
// pending indefinitely — there is no auto-expiry per the #17 spec.
import type { Database } from "better-sqlite3";
import { randomBytes } from "node:crypto";

export type WikiProposalKind = "role" | "skill" | "industry";

export interface PendingWikiProposal {
	proposal_id: string;
	kind: WikiProposalKind;
	slug: string;
	markdown: string;
	target?: string | null;
	created_at: string;
}

export class PendingWikiProposalsRepo {
	constructor(private db: Database) {}

	create(opts: { kind: WikiProposalKind; slug: string; markdown: string; target?: string }): PendingWikiProposal {
		const now = new Date().toISOString();
		const proposal: PendingWikiProposal = {
			proposal_id: `wikip_${randomBytes(8).toString("hex")}`,
			kind: opts.kind,
			slug: opts.slug,
			markdown: opts.markdown,
			target: opts.target ?? null,
			created_at: now,
		};
		this.db
			.prepare(
				`INSERT INTO pending_wiki_proposals (proposal_id, kind, slug, markdown, target, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(proposal.proposal_id, proposal.kind, proposal.slug, proposal.markdown, proposal.target, proposal.created_at);
		return proposal;
	}

	get(proposal_id: string): PendingWikiProposal | undefined {
		const row = this.db
			.prepare(`SELECT proposal_id, kind, slug, markdown, target, created_at FROM pending_wiki_proposals WHERE proposal_id = ?`)
			.get(proposal_id) as PendingWikiProposal | undefined;
		return row ?? undefined;
	}

	list(): PendingWikiProposal[] {
		return this.db
			.prepare(
				`SELECT proposal_id, kind, slug, markdown, target, created_at FROM pending_wiki_proposals
				 ORDER BY created_at, proposal_id`,
			)
			.all() as PendingWikiProposal[];
	}

	delete(proposal_id: string): boolean {
		const info = this.db.prepare(`DELETE FROM pending_wiki_proposals WHERE proposal_id = ?`).run(proposal_id);
		return info.changes > 0;
	}
}
