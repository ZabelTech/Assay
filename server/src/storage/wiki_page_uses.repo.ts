// #15 + #16 usage-tracking hook. When the structurer consumes a wiki page that
// influences a draft, the pipeline records a row here at publish time. The
// future staleness-exemption logic ("a page re-validated by use across old
// and new evidence dates is exempt from the 12-month freshness warning")
// will read from this table; v0 only ships the data hook.
import type { Database } from "better-sqlite3";

export interface WikiPageUse {
	slug: string;
	claim_id: string;
	used_at: string;
}

export class WikiPageUsesRepo {
	constructor(private db: Database) {}

	record(opts: { slug: string; claim_id: string }): void {
		this.db
			.prepare(
				`INSERT INTO wiki_page_uses (slug, claim_id, used_at) VALUES (?, ?, ?)`,
			)
			.run(opts.slug, opts.claim_id, new Date().toISOString());
	}

	listForSlug(slug: string): WikiPageUse[] {
		return this.db
			.prepare(`SELECT slug, claim_id, used_at FROM wiki_page_uses WHERE slug = ? ORDER BY used_at`)
			.all(slug) as WikiPageUse[];
	}
}
