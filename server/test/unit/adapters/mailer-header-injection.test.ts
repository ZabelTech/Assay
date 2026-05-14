// Mailer header-injection guard.
import { describe, expect, it } from "vitest";
import { CaptureMailer, assertSafeMailHeaders } from "../../../src/adapters/mailer.js";

describe("mailer CRLF injection guard", () => {
	it("rejects newlines in `to`", async () => {
		// WHY: a `to` like "user@example.com\nBcc: attacker@evil.com" is the
		// classic SMTP header-injection vector. nodemailer also rejects, but the
		// adapter is the right place to fail loud — invariant should hold for
		// the CaptureMailer used in tests too.
		const mailer = new CaptureMailer();
		await expect(
			mailer.send({
				to: "user@example.com\nBcc: attacker@evil.com",
				subject: "ok",
				body: "ok",
			}),
		).rejects.toThrow(/forbidden CR\/LF\/NUL/);
	});

	it("rejects carriage returns in `subject`", async () => {
		const mailer = new CaptureMailer();
		await expect(
			mailer.send({ to: "u@example.com", subject: "ok\rX-Injected: yes", body: "ok" }),
		).rejects.toThrow();
	});

	it("rejects NUL bytes", () => {
		expect(() =>
			assertSafeMailHeaders({ to: "u@example.com", subject: "x\0y", body: "ok" }),
		).toThrow();
	});

	it("allows newlines in `body` (bodies legitimately wrap)", async () => {
		const mailer = new CaptureMailer();
		await mailer.send({
			to: "u@example.com",
			subject: "Verify your endpoint",
			body: "Hi,\n\nClick the link below to verify.\n\nhttps://example.com/verify?challenge=abc\n",
		});
		expect(mailer.outbox().length).toBe(1);
	});
});
