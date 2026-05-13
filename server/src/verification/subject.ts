// §4.1 — Subject email verification. Challenge → email → response → marked verified.
import type { Mailer } from "../adapters/mailer.js";
import type { SubjectRepo } from "../storage/subject.repo.js";

// Structural shape — accepts both the full BuildAppDeps (transport) and the focused
// AdminSubjectDeps (admin layer). Keeps the verification primitives reusable.
interface SubjectVerifyDeps {
	subjects: SubjectRepo;
	mailer: Mailer;
	operatorUrl: string;
}

export async function handleSubjectVerifyStart(
	deps: SubjectVerifyDeps,
	body: { email?: string; method?: string },
): Promise<{ ok: boolean }> {
	const email = body.email;
	const method = body.method;
	if (!email || (method !== "click_through_link" && method !== "code_return")) {
		return { ok: false };
	}
	const { challenge, code } = deps.subjects.createChallenge(email, method);
	const linkBody =
		method === "click_through_link"
			? `Confirm control of ${email}:\n${deps.operatorUrl}/admin/api/subject/verify/complete?challenge=${challenge}\n`
			: `Your verification code: ${code}\nEnter at: ${deps.operatorUrl}/admin\n`;
	await deps.mailer.send({
		to: email,
		subject: "Verify your Cairn endpoint",
		body: linkBody,
	});
	return { ok: true };
}

export function handleSubjectVerifyComplete(
	deps: SubjectVerifyDeps,
	input: { challenge?: string; email?: string; code?: string },
): boolean {
	const consumed = deps.subjects.consumeChallenge(input);
	if (!consumed) return false;
	deps.subjects.markVerified(consumed.email, { challenge_method: consumed.method });
	return true;
}
