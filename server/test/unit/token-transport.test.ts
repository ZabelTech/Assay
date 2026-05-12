// §9.1.1 — Three token transport forms; equality across forms; Referer rejection; routing safety.
import { describe, expect, it } from "vitest";
import { extractToken } from "../../src/mcp/auth.js";

function makeReq(opts: {
	path?: string;
	headers?: Record<string, string>;
	query?: Record<string, string>;
}): Request {
	const url = new URL(`http://localhost${opts.path ?? "/mcp"}`);
	for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
	return new Request(url.toString(), {
		method: "POST",
		headers: opts.headers ?? {},
		body: "{}",
	});
}

describe("§9.1.1 token transport", () => {
	it("extracts from Authorization: Bearer header", () => {
		const result = extractToken(makeReq({ headers: { authorization: "Bearer abc123" } }));
		expect(result.token).toBe("abc123");
		expect(result.mismatch).toBe(false);
	});

	it("extracts from ?t= query parameter", () => {
		const result = extractToken(makeReq({ query: { t: "abc123" } }));
		expect(result.token).toBe("abc123");
		expect(result.mismatch).toBe(false);
	});

	it("extracts from /t/<token> path segment", () => {
		const result = extractToken(makeReq({ path: "/mcp/t/abc123" }));
		expect(result.token).toBe("abc123");
		expect(result.mismatch).toBe(false);
	});

	it("accepts the same token in all three forms simultaneously", () => {
		// WHY: §9.1.1 — equality across forms is required; clients may send both.
		const result = extractToken(
			makeReq({
				path: "/mcp/t/abc123",
				headers: { authorization: "Bearer abc123" },
				query: { t: "abc123" },
			}),
		);
		expect(result.token).toBe("abc123");
		expect(result.mismatch).toBe(false);
	});

	it("flags mismatch when header and query tokens disagree", () => {
		// WHY: §9.1.1 — mismatched forms MUST be rejected as malformed. Prevents silent override.
		const result = extractToken(
			makeReq({ headers: { authorization: "Bearer abc123" }, query: { t: "xyz789" } }),
		);
		expect(result.mismatch).toBe(true);
	});

	it("flags mismatch when path and header tokens disagree", () => {
		const result = extractToken(
			makeReq({ path: "/mcp/t/abc123", headers: { authorization: "Bearer xyz789" } }),
		);
		expect(result.mismatch).toBe(true);
	});

	it("ignores tokens presented in Referer header", () => {
		// WHY: §9.5 — Servers MUST NOT honor tokens from Referer. Closes a browser leakage vector.
		const result = extractToken(makeReq({ headers: { referer: "https://x.com/mcp?t=leaked" } }));
		expect(result.token).toBeUndefined();
	});

	it("accepts case-insensitive Authorization header name", () => {
		// WHY: HTTP headers are case-insensitive; clients vary in casing.
		const result = extractToken(makeReq({ headers: { Authorization: "Bearer abc123" } }));
		expect(result.token).toBe("abc123");
	});

	it("recognizes /t/<token> even when trailing path follows", () => {
		// WHY: §9.5 routing safety — /mcp/t/abc/initialize must consume the token, then route correctly.
		const result = extractToken(makeReq({ path: "/mcp/t/abc123/initialize" }));
		expect(result.token).toBe("abc123");
	});

	it("returns no token when no form carries one", () => {
		const result = extractToken(makeReq({}));
		expect(result.token).toBeUndefined();
		expect(result.mismatch).toBe(false);
	});
});
