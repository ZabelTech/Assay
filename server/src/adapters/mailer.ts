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

export class CaptureMailer implements Mailer {
	private box: CapturedEmail[] = [];

	async send(email: CapturedEmail): Promise<void> {
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
		await this.transporter.sendMail({
			from: this.config.from,
			to: email.to,
			subject: email.subject,
			text: email.body,
		});
	}
}
