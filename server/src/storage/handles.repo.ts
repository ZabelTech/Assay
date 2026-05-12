// #7 handle / subdomain storage (hosted deployments). Single-row table mapping the
// current handle to its set_at timestamp.
import type { Database } from "better-sqlite3";

export class HandlesRepo {
	constructor(private db: Database) {}

	get(): { handle: string; set_at: string } | undefined {
		const row = this.db.prepare(`SELECT handle, set_at FROM handles WHERE id = 1`).get() as
			| { handle: string; set_at: string }
			| undefined;
		return row ?? undefined;
	}

	set(handle: string): void {
		this.db
			.prepare(
				`INSERT INTO handles (id, handle, set_at) VALUES (1, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, set_at = excluded.set_at`,
			)
			.run(handle, new Date().toISOString());
	}
}
