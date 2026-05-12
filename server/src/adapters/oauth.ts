// #7 OAuth provider abstraction. Concrete LinkedIn / GitHub impls ship in a follow-up;
// per the #7 acceptance, "LinkedIn and GitHub OAuth providers are mocked in the automated
// test; real-provider OAuth is verified out-of-band."
export interface OAuthProvider {
	id: string; // e.g. "linkedin", "github"
	getAuthorizationUrl(state: string): string;
	exchangeCode(code: string): Promise<{ access_token: string }>;
	fetchProfile(access_token: string): Promise<{ raw: string }>;
}

export class MockOAuthProvider implements OAuthProvider {
	private profiles = new Map<string, string>(); // access_token → raw profile

	constructor(public id: string) {}

	registerProfile(access_token: string, raw: string): void {
		this.profiles.set(access_token, raw);
	}

	getAuthorizationUrl(state: string): string {
		return `https://mock.${this.id}.example/authorize?state=${encodeURIComponent(state)}`;
	}

	async exchangeCode(code: string): Promise<{ access_token: string }> {
		// Echo the code as a deterministic access token for tests.
		return { access_token: `mock-${this.id}-${code}` };
	}

	async fetchProfile(access_token: string): Promise<{ raw: string }> {
		const raw = this.profiles.get(access_token);
		if (!raw) throw new Error(`MockOAuthProvider: no profile registered for ${access_token}`);
		return { raw };
	}
}
