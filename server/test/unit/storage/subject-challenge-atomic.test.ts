// Subject and endorsement challenge consumption is single-use. The repo must
// expose CAS semantics: a second consume of the same challenge MUST return
// undefined even when racing the first one. The pre-fix implementation did a
// SELECT-then-UPDATE pair, which two concurrent callers could both pass.
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { SubjectRepo } from "../../../src/storage/subject.repo.js";

describe("SubjectRepo.consumeChallenge — single-use guarantee", () => {
	it("returns undefined on the second consume of the same challenge token", () => {
		// WHY: this is what makes the challenge a credential — the second click on
		// the magic link must not re-verify the subject.
		const db = openDatabase(":memory:");
		const subjects = new SubjectRepo(db);
		const { challenge } = subjects.createChallenge("alice@example.com", "click_through_link");

		const first = subjects.consumeChallenge({ challenge });
		const second = subjects.consumeChallenge({ challenge });

		expect(first).toEqual({ email: "alice@example.com", method: "click_through_link" });
		expect(second).toBeUndefined();
		db.close();
	});

	it("returns undefined on the second consume via email+code", () => {
		const db = openDatabase(":memory:");
		const subjects = new SubjectRepo(db);
		const { code } = subjects.createChallenge("alice@example.com", "code_return");
		expect(code).toBeDefined();

		const first = subjects.consumeChallenge({ email: "alice@example.com", code: code! });
		const second = subjects.consumeChallenge({ email: "alice@example.com", code: code! });

		expect(first?.email).toBe("alice@example.com");
		expect(second).toBeUndefined();
		db.close();
	});
});

describe("SubjectRepo.consumeEndorsementChallenge — single-use guarantee", () => {
	it("returns undefined on the second consume of the same challenge", () => {
		// WHY: an endorsement is a per-endorser, per-payload credential. Replaying
		// the link must not produce duplicate email_attested claims.
		const db = openDatabase(":memory:");
		const subjects = new SubjectRepo(db);
		const { challenge } = subjects.createEndorsementChallenge({
			endorser_email: "bob@acme.com",
			value: { summary: "alice shipped it" },
		});

		const first = subjects.consumeEndorsementChallenge(challenge);
		const second = subjects.consumeEndorsementChallenge(challenge);

		expect(first?.endorser_email).toBe("bob@acme.com");
		expect(second).toBeUndefined();
		db.close();
	});
});
