// #17 URL snapshot fetcher. Fetches the raw bytes of a URL with the §17 retry
// schedule and HTTP-status classification. Returns the raw response on success,
// throws SnapshotFetchError on terminal failure.
//
// Out of scope here: HTML→markdown conversion (that lives in the
// UrlSnapshotNormalizer in #15) and login-wall / captcha detection beyond the
// status-code level (4xx fails loud).
import { setTimeout as delay } from "node:timers/promises";

export interface SnapshotResult {
	raw: Buffer;
	mediaType: string;
	fetchedAt: string; // ISO-8601
	url: string;
	httpStatus: number;
}

export class SnapshotFetchError extends Error {
	constructor(
		message: string,
		public readonly classification:
			| "client_error"
			| "server_error_exhausted"
			| "rate_limited_exhausted"
			| "network_exhausted"
			| "tls_error"
			| "not_implemented"
			| "unknown",
		public readonly attempts: number,
		public readonly lastStatus?: number,
	) {
		super(message);
		this.name = "SnapshotFetchError";
	}
}

// Retry schedule per the #17 spec: 4 attempts total (initial + 3 retries),
// delays 1s, 2s, 4s between attempts. Tests inject smaller delays via the
// options arg to keep the suite fast.
export const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_AFTER_STATUSES = new Set([429, 503]);

export interface UrlSnapshotFetcherOptions {
	// Pluggable fetch (defaults to global fetch). Tests substitute a stub.
	fetchImpl?: typeof fetch;
	// Override the delay schedule (tests use [0,0,0] for speed).
	retryDelaysMs?: number[];
	// Override the sleep function (tests substitute a no-op).
	sleep?: (ms: number) => Promise<void>;
}

export class UrlSnapshotFetcher {
	private readonly fetchImpl: typeof fetch;
	private readonly retryDelaysMs: number[];
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(opts: UrlSnapshotFetcherOptions = {}) {
		this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
		this.retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
		this.sleep = opts.sleep ?? ((ms: number) => delay(ms));
	}

	async fetch(url: string): Promise<SnapshotResult> {
		const maxAttempts = 1 + this.retryDelaysMs.length;
		let lastStatus: number | undefined;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			let response: Response;
			try {
				response = await this.fetchImpl(url);
			} catch (err) {
				// Distinguish TLS / certificate errors (don't retry — the operator must
				// either trust the cert or use a different URL) from generic network
				// errors (retry on the schedule).
				const msg = err instanceof Error ? err.message : String(err);
				if (/cert|tls|ssl/i.test(msg)) {
					throw new SnapshotFetchError(`TLS / certificate error: ${msg}`, "tls_error", attempt);
				}
				if (attempt >= maxAttempts) {
					throw new SnapshotFetchError(
						`network failure after ${attempt} attempts: ${msg}`,
						"network_exhausted",
						attempt,
					);
				}
				await this.sleep(this.retryDelaysMs[attempt - 1]!);
				continue;
			}

			lastStatus = response.status;

			if (response.ok) {
				const buffer = Buffer.from(await response.arrayBuffer());
				return {
					raw: buffer,
					mediaType: response.headers.get("content-type") ?? "application/octet-stream",
					fetchedAt: new Date().toISOString(),
					url,
					httpStatus: response.status,
				};
			}

			if (response.status === 501) {
				throw new SnapshotFetchError(`501 Not Implemented at ${url}`, "not_implemented", attempt, 501);
			}
			if (!RETRY_STATUS.has(response.status)) {
				// All other 4xx (incl. 401/403/404/410) and other 5xx (non-retry) fail loud
				// immediately. The caller surfaces this reason to the candidate.
				throw new SnapshotFetchError(
					`${response.status} ${response.statusText} at ${url}`,
					"client_error",
					attempt,
					response.status,
				);
			}
			if (attempt >= maxAttempts) {
				const cls = response.status === 429 ? "rate_limited_exhausted" : "server_error_exhausted";
				throw new SnapshotFetchError(
					`${response.status} after ${attempt} attempts at ${url}`,
					cls,
					attempt,
					response.status,
				);
			}

			// Compute next-attempt delay. For 429 and 503, honor Retry-After when
			// present; otherwise fall back to the default schedule.
			let waitMs = this.retryDelaysMs[attempt - 1]!;
			if (RETRY_AFTER_STATUSES.has(response.status)) {
				const ra = parseRetryAfter(response.headers.get("retry-after"));
				if (ra !== null) waitMs = ra;
			}
			await this.sleep(waitMs);
		}
		// Unreachable — every loop iteration either returns or throws — but keep
		// TypeScript happy.
		throw new SnapshotFetchError("retry loop exited without resolving", "unknown", maxAttempts, lastStatus);
	}
}

// Parses the Retry-After header. RFC 7231: either "<seconds>" or an HTTP-date.
// Returns the wait time in ms, or null if the header is missing / malformed.
function parseRetryAfter(header: string | null): number | null {
	if (!header) return null;
	const trimmed = header.trim();
	if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000;
	const t = Date.parse(trimmed);
	if (Number.isNaN(t)) return null;
	const ms = t - Date.now();
	return ms > 0 ? ms : 0;
}
