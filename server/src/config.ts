// Environment config parsing with sensible defaults.

export interface Config {
	port: number;
	dbPath: string;
	subject: string;
	operatorUrl: string;
	operatorType: "hosted" | "self_hosted" | "experimental";
	mailer: "capture" | "smtp";
	smtp: {
		host?: string;
		port?: number;
		secure?: boolean;
		user?: string;
		pass?: string;
		from?: string;
	};
	corsOrigins: string[];
	rateLimit: { window_ms: number; max: number };
	evidenceDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	return {
		port: parseInt(env.PORT ?? "3000", 10),
		dbPath: env.DB_PATH ?? "/data/cairn.db",
		subject: env.SUBJECT ?? "",
		operatorUrl: env.OPERATOR_URL ?? "http://localhost:3000",
		operatorType: ((env.OPERATOR_TYPE ?? "self_hosted") as Config["operatorType"]),
		mailer: ((env.MAILER ?? "capture") as Config["mailer"]),
		smtp: {
			host: env.SMTP_HOST,
			port: env.SMTP_PORT ? parseInt(env.SMTP_PORT, 10) : undefined,
			secure: env.SMTP_SECURE === "true",
			user: env.SMTP_USER,
			pass: env.SMTP_PASS,
			from: env.SMTP_FROM,
		},
		corsOrigins: (env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
		rateLimit: {
			window_ms: parseInt(env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
			max: parseInt(env.RATE_LIMIT_MAX ?? "60", 10),
		},
		evidenceDir: env.EVIDENCE_DIR ?? "/data/evidence",
	};
}
