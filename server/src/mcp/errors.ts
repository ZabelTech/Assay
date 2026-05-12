// Cairn-specific JSON-RPC error codes. See spec §10.4.

export const ERROR_CODES = {
	token_invalid: -32001,
	token_expired: -32002,
	token_revoked: -32003,
	token_mismatch: -32004,
	claim_not_visible: -32005,
	claim_not_found: -32006,
	subject_unverified: -32007,
	malformed_input: -32008,
	rate_limited: -32009,
	unauthorized_admin: -32010,
} as const;

export type ErrorSymbol = keyof typeof ERROR_CODES;

export class CairnError extends Error {
	readonly code: number;
	readonly symbol: ErrorSymbol;
	readonly data?: Record<string, unknown>;

	constructor(symbol: ErrorSymbol, message?: string, data?: Record<string, unknown>) {
		super(message ?? symbol);
		this.symbol = symbol;
		this.code = ERROR_CODES[symbol];
		this.data = data;
	}

	toRpcError(): { code: number; message: string; data?: Record<string, unknown> } {
		return {
			code: this.code,
			message: this.message,
			data: { symbol: this.symbol, ...(this.data ?? {}) },
		};
	}
}
