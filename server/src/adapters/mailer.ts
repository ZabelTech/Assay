// Mailer adapter. CaptureMailer used in tests; SmtpMailer in production.
import nodemailer from "nodemailer";

export interface CapturedEmail {
	to: string;
	subject: string;
	body: string;
}

export interface Mailer {
	send(email: CapturedEmail): Promise<void>;
}

// Header-injection defence. `to` and `subject` are emitted as RFC 5322 headers;
// a CR/LF/NUL byte in either lets a caller inject a Bcc or rewrite the From
// line. Body is unconstrained — bodies legitimately contain newlines.
// nodemailer rejects this at send time, but failing here gives the admin layer
// a clean error and stops a malformed value from reaching the wire at all.
export function assertSafeMailHeaders(email: CapturedEmail): void {
	for (const field of ["to", "subject"] as const) {
		const v = email[field];
		if (typeof v !== "string") {
			throw new Error(`mail ${field} must be a string`);
		}
		if (/[\r\n\0]/.test(v)) {
			throw new Error(`mail ${field} contains a forbidden CR/LF/NUL byte`);
		}
	}
}

export class CaptureMailer implements Mailer {
	private box: CapturedEmail[] = [];

	async send(email: CapturedEmail): Promise<void> {
		assertSafeMailHeaders(email);
		this.box.push(email);
	}

	outbox(): CapturedEmail[] {
		return [...this.box];
	}

	clear(): void {
		this.box = [];
	}
}

export interface SmtpConfig {
	host: string;
	port: number;
	secure?: boolean;
	user?: string;
	pass?: string;
	from: string;
}

export class SmtpMailer implements Mailer {
	private transporter: nodemailer.Transporter;

	constructor(private config: SmtpConfig) {
		this.transporter = nodemailer.createTransport({
			host: config.host,
			port: config.port,
			secure: config.secure ?? false,
			auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
		});
	}

	async send(email: CapturedEmail): Promise<void> {
		assertSafeMailHeaders(email);
		await this.transporter.sendMail({
			from: this.config.from,
			to: email.to,
			subject: email.subject,
			text: email.body,
		});
	}
}
