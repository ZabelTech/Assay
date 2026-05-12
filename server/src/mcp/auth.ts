// Token extraction across the three forms in §9.1.1. Equality enforced; Referer ignored.

export interface ExtractedToken {
	token?: string;
	mismatch: boolean;
}

export function extractToken(req: Request): ExtractedToken {
	const fromHeader = readAuthorizationBearer(req);
	const fromQuery = readQueryToken(req);
	const fromPath = readPathToken(req);

	const presented = [fromHeader, fromQuery, fromPath].filter((t): t is string => Boolean(t));
	if (presented.length === 0) return { mismatch: false };

	const first = presented[0]!;
	if (presented.some((t) => t !== first)) return { mismatch: true };

	return { token: first, mismatch: false };
}

function readAuthorizationBearer(req: Request): string | undefined {
	// HTTP headers are case-insensitive; Request normalizes them but be explicit.
	const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
	if (!auth) return undefined;
	const match = /^Bearer\s+(\S+)/i.exec(auth);
	return match ? match[1] : undefined;
}

function readQueryToken(req: Request): string | undefined {
	const url = new URL(req.url);
	return url.searchParams.get("t") ?? undefined;
}

function readPathToken(req: Request): string | undefined {
	const url = new URL(req.url);
	const match = /\/t\/([^/?]+)/.exec(url.pathname);
	return match ? match[1] : undefined;
}

// §9.5 — tokens in Referer MUST NOT be honored. This helper exists to make the policy explicit;
// extractToken already never reads Referer, but call sites that read other headers should not look there either.
export function refererTokenIsIgnored(_req: Request): true {
	return true;
}
