// #17 UrlSnapshotFetcher. The retry/classification matrix is pinned end-to-end:
// the issue's HTTP-status table is the contract a fixed schedule has to honor.
// We supply a stub `fetch` and a no-op `sleep` so the suite stays fast.
import { describe, expect, it, vi } from "vitest";
import { SnapshotFetchError, UrlSnapshotFetcher } from "../../../src/adapters/url_snapshot.js";

function makeFetcher(responses: (Response | Error)[]): { fetcher: UrlSnapshotFetcher; sleeps: number[] } {
	let i = 0;
	const sleeps: number[] = [];
	const fetcher = new UrlSnapshotFetcher({
		retryDelaysMs: [1, 2, 4], // shape preserved; values shrunk for test speed
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		fetchImpl: (async () => {
			if (i >= responses.length) throw new Error("ran out of stubbed responses");
			const v = responses[i++]!;
			if (v instanceof Error) throw v;
			return v;
		}) as typeof fetch,
	});
	return { fetcher, sleeps };
}

function htmlResponse(status: number, body = "ok", headers: Record<string, string> = {}): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "text/html; charset=utf-8", ...headers },
	});
}

describe("UrlSnapshotFetcher", () => {
	// WHY: the happy path must produce raw bytes + media type + an ISO fetched_at.
	// The structurer's UrlSnapshotNormalizer (#15) depends on the media type
	// being present so it can pick the right normalizer.
	it("returns raw bytes, media type, and fetched_at on 200", async () => {
		const { fetcher, sleeps } = makeFetcher([htmlResponse(200, "<html>hi</html>")]);
		const result = await fetcher.fetch("https://example.com/page");
		expect(result.httpStatus).toBe(200);
		expect(result.mediaType).toMatch(/text\/html/);
		expect(result.raw.toString()).toBe("<html>hi</html>");
		expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(sleeps).toEqual([]);
	});

	// WHY: 429 with Retry-After is the most consequential retry case for real
	// providers — honoring the header avoids hammering rate-limited APIs. The
	// header value supersedes the default schedule for that attempt.
	it("429 with Retry-After honors the header on retry", async () => {
		const { fetcher, sleeps } = makeFetcher([
			htmlResponse(429, "slow down", { "retry-after": "7" }),
			htmlResponse(200, "ok"),
		]);
		await fetcher.fetch("https://example.com/page");
		// First (and only) sleep should be 7s from Retry-After, not the 1s default.
		expect(sleeps).toEqual([7000]);
	});

	// WHY: 429 across all four attempts must classify as rate_limited_exhausted —
	// the candidate sees a specific reason rather than a generic "fetch failed."
	it("exhausts retries on persistent 429 and classifies as rate_limited_exhausted", async () => {
		const { fetcher } = makeFetcher([
			htmlResponse(429),
			htmlResponse(429),
			htmlResponse(429),
			htmlResponse(429),
		]);
		await expect(fetcher.fetch("https://example.com/x")).rejects.toMatchObject({
			classification: "rate_limited_exhausted",
			lastStatus: 429,
			attempts: 4,
		});
	});

	// WHY: 404 is fail-loud-immediately per the #17 status table — no retries
	// (the URL truly doesn't resolve, retrying would be noise).
	it("404 fails immediately with no retry", async () => {
		const { fetcher, sleeps } = makeFetcher([htmlResponse(404, "missing")]);
		const promise = fetcher.fetch("https://example.com/missing");
		await expect(promise).rejects.toBeInstanceOf(SnapshotFetchError);
		await expect(promise).rejects.toMatchObject({ classification: "client_error", lastStatus: 404, attempts: 1 });
		expect(sleeps).toEqual([]);
	});

	// WHY: 401 (login-walled) must surface with a clear reason so the candidate
	// understands why the snapshot failed — the structurer doesn't substitute a
	// hallucinated answer; the candidate has to pick a different source.
	it("401 fails immediately with the reason text in the error message", async () => {
		const { fetcher } = makeFetcher([htmlResponse(401, "auth required")]);
		await expect(fetcher.fetch("https://example.com/private")).rejects.toMatchObject({
			classification: "client_error",
			lastStatus: 401,
			message: expect.stringContaining("401"),
		});
	});

	// WHY: network errors (connection refused, DNS, reset) retry per the schedule —
	// distinguishes "transient" from "the URL is just bad." Schedule shape matches
	// the spec: 3 retries means 3 sleeps before the final attempt.
	it("network errors retry per the schedule and classify on exhaustion", async () => {
		const { fetcher, sleeps } = makeFetcher([
			new Error("ECONNRESET"),
			new Error("ECONNRESET"),
			new Error("ECONNRESET"),
			new Error("ECONNRESET"),
		]);
		await expect(fetcher.fetch("https://example.com/x")).rejects.toMatchObject({
			classification: "network_exhausted",
			attempts: 4,
		});
		expect(sleeps).toEqual([1, 2, 4]);
	});

	// WHY: 501 is fail-loud-immediately per the table — the server is telling us
	// the operation isn't supported, retrying won't change that.
	it("501 fails immediately as not_implemented", async () => {
		const { fetcher } = makeFetcher([htmlResponse(501, "no")]);
		await expect(fetcher.fetch("https://example.com/x")).rejects.toMatchObject({
			classification: "not_implemented",
		});
	});

	// WHY: TLS / certificate errors don't retry — the operator either trusts the
	// cert or uses a different URL. Retrying would never succeed.
	it("TLS errors fail immediately as tls_error", async () => {
		const { fetcher, sleeps } = makeFetcher([new Error("unable to verify the first certificate (TLS handshake failed)")]);
		await expect(fetcher.fetch("https://example.com/x")).rejects.toMatchObject({
			classification: "tls_error",
		});
		expect(sleeps).toEqual([]);
	});

	// WHY: a transient 503 followed by a 200 is the happy-recovery path the retry
	// schedule exists for. Pins that the schedule and the success unwind both
	// fire.
	it("recovers from a 503 followed by a 200", async () => {
		const { fetcher, sleeps } = makeFetcher([htmlResponse(503), htmlResponse(200, "good")]);
		const result = await fetcher.fetch("https://example.com/x");
		expect(result.httpStatus).toBe(200);
		expect(result.raw.toString()).toBe("good");
		expect(sleeps).toEqual([1]);
	});
});
