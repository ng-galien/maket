/**
 * gmail-client — OAuth2 + Gmail API wrapper.
 *
 * State (auth, connected, pending OAuth callback) lives inside a closure so
 * instances are isolated and testable. Credentials are resolved via env first,
 * JSON file second — both sources are injectable for tests.
 *
 * Real `googleapis` calls are lazy (dynamic import) so importing this module
 * does not pay the googleapis parse cost when gmail is unused.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DRAFT_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function buildScopes(withRead: boolean): string[] {
	return withRead ? [DRAFT_SCOPE, READ_SCOPE] : [DRAFT_SCOPE];
}

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const STATE_TTL_MS = OAUTH_TIMEOUT_MS;

export interface Credentials {
	client_id: string;
	client_secret: string;
}

export interface CredentialSources {
	env: Record<string, string | undefined>;
	readFile: (path: string) => string;
	exists: (path: string) => boolean;
	credentialsPath?: string;
}

/** Pure — pick credentials from env or JSON file, or throw. */
export function loadCredentials(sources: CredentialSources): Credentials {
	const { env, readFile, exists, credentialsPath } = sources;
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
		return {
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
		};
	}
	const path = credentialsPath ?? "";
	if (!path || !exists(path)) {
		throw new Error(
			"Google credentials not found.\n" +
				"Quickest path: open http://localhost:<MAKET_PORT>/setup/gmail and paste the OAuth Desktop JSON from Google Cloud Console.\n" +
				"Manual path: set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env,\n" +
				`or drop the JSON at ${path || "<unset>"}`,
		);
	}
	const keys = JSON.parse(readFile(path));
	return keys.installed || keys.web;
}

export interface GmailGrants {
	/** Always true when connected — drafts are mandatory. */
	draft: boolean;
	/** True only if the user opted into gmail.readonly at connect time. */
	read: boolean;
}

export interface GmailClient {
	tryRestore(): Promise<boolean>;
	getAuthUrl(
		redirectUri: string,
		opts?: { withRead?: boolean },
	): Promise<string>;
	startAuth(): Promise<void>;
	handleCallback(
		code: string,
		state: string,
		redirectUri: string,
	): Promise<string>;
	getGmail(): Promise<any>;
	isConnected(): boolean;
	grants(): GmailGrants;
}

export interface GmailClientInputs {
	dataDir: string;
	env?: Record<string, string | undefined>;
}

interface SavedToken {
	refreshToken: string;
	withRead: boolean;
}

function createOAuthStateStore(): {
	newState(): string;
	consumeState(state: string): boolean;
} {
	const pendingStates = new Map<string, number>();
	return {
		newState() {
			const state = randomBytes(32).toString("base64url");
			const now = Date.now();
			pendingStates.set(state, now + STATE_TTL_MS);
			for (const [k, t] of pendingStates) {
				if (t < now) pendingStates.delete(k);
			}
			return state;
		},
		consumeState(state) {
			const expiresAt = pendingStates.get(state);
			if (!expiresAt || expiresAt < Date.now()) {
				pendingStates.delete(state);
				return false;
			}
			pendingStates.delete(state);
			return true;
		},
	};
}

function readSavedToken(tokenPath: string): SavedToken | null {
	if (!existsSync(tokenPath)) return null;
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(tokenPath, "utf-8"));
	} catch {
		return null;
	}
	if (!data || typeof data !== "object") return null;
	const payload = data as { refresh_token?: unknown; with_read?: unknown };
	const refreshToken =
		typeof payload.refresh_token === "string" ? payload.refresh_token : null;
	if (!refreshToken) return null;
	return { refreshToken, withRead: payload.with_read === true };
}

function writeSavedToken(
	tokenPath: string,
	refreshToken: string,
	withRead: boolean,
): void {
	const payload = JSON.stringify({
		refresh_token: refreshToken,
		with_read: withRead,
	});
	const tmpPath = `${tokenPath}.tmp`;
	writeFileSync(tmpPath, payload, { mode: 0o600 });
	renameSync(tmpPath, tokenPath);
}

// code-moniker: ignore[smell-feature-envy-local]
// OAuth callback: state check, token exchange, profile lookup, token persist.
async function completeGmailOAuthCallback(ctx: {
	code: string;
	state: string;
	redirectUri: string;
	consumeState: (state: string) => boolean;
	resolveCreds: () => { client_id: string; client_secret: string };
	tokenPath: string;
	setAuth: (auth: unknown) => void;
	setConnected: (v: boolean) => void;
	setReadGranted: (v: boolean) => void;
	clearPending: () => void;
}): Promise<string> {
	if (!ctx.consumeState(ctx.state)) {
		throw new Error(
			"Invalid or expired OAuth state — restart the connect flow",
		);
	}
	const { google } = await import("googleapis");
	const creds = ctx.resolveCreds();
	const oauth2 = new google.auth.OAuth2(
		creds.client_id,
		creds.client_secret,
		ctx.redirectUri,
	);
	const { tokens } = await oauth2.getToken(ctx.code);
	oauth2.setCredentials(tokens);
	const grantedScopes =
		typeof tokens.scope === "string" ? tokens.scope.split(" ") : [];
	const withRead = grantedScopes.includes(READ_SCOPE);
	ctx.setReadGranted(withRead);
	if (tokens.refresh_token) {
		writeSavedToken(ctx.tokenPath, tokens.refresh_token, withRead);
	}
	ctx.setAuth(oauth2);
	ctx.setConnected(true);
	ctx.clearPending();
	const gmail = google.gmail({ version: "v1", auth: oauth2 });
	const profile = await gmail.users.getProfile({ userId: "me" });
	return profile.data.emailAddress || "";
}

export function createGmailClient(inputs: GmailClientInputs): GmailClient {
	const env = inputs.env ?? process.env;
	const credentialsPath = join(inputs.dataDir, "google-credentials.json");
	const tokenPath = join(inputs.dataDir, "google-token.json");
	const oauthStates = createOAuthStateStore();

	let auth: any = null;
	let connected = false;
	let readGranted = false;
	let pendingResolve: (() => void) | null = null;
	let pendingReject: ((err: Error) => void) | null = null;

	const resolveCreds = () =>
		loadCredentials({
			env,
			readFile: (p) => readFileSync(p, "utf-8"),
			exists: existsSync,
			credentialsPath,
		});

	const client: GmailClient = {
		async tryRestore() {
			if (connected) return true;
			const saved = readSavedToken(tokenPath);
			if (!saved) return false;
			const { google } = await import("googleapis");
			const creds = resolveCreds();
			const oauth2 = new google.auth.OAuth2(
				creds.client_id,
				creds.client_secret,
			);
			oauth2.setCredentials({ refresh_token: saved.refreshToken });
			auth = oauth2;
			connected = true;
			readGranted = saved.withRead;
			return true;
		},

		async getAuthUrl(redirectUri: string, opts) {
			const withRead = opts?.withRead === true;
			const { google } = await import("googleapis");
			const creds = resolveCreds();
			const oauth2 = new google.auth.OAuth2(
				creds.client_id,
				creds.client_secret,
				redirectUri,
			);
			return oauth2.generateAuthUrl({
				access_type: "offline",
				scope: buildScopes(withRead),
				prompt: "consent",
				state: oauthStates.newState(),
			});
		},

		startAuth() {
			return new Promise<void>((resolve, reject) => {
				pendingResolve = resolve;
				pendingReject = reject;
				setTimeout(() => {
					if (pendingReject) {
						pendingReject(
							new Error(
								"OAuth timeout — no callback received within 5 minutes",
							),
						);
						pendingResolve = null;
						pendingReject = null;
					}
				}, OAUTH_TIMEOUT_MS);
			});
		},

		handleCallback: (code, state, redirectUri) =>
			completeGmailOAuthCallback({
				code,
				state,
				redirectUri,
				consumeState: (s) => oauthStates.consumeState(s),
				resolveCreds,
				tokenPath,
				setAuth: (oauth2) => {
					auth = oauth2;
				},
				setConnected: (v) => {
					connected = v;
				},
				setReadGranted: (v) => {
					readGranted = v;
				},
				clearPending: () => {
					if (pendingResolve) {
						pendingResolve();
						pendingResolve = null;
						pendingReject = null;
					}
				},
			}),

		async getGmail() {
			if (!connected || !auth) {
				const restored = await this.tryRestore();
				if (!restored)
					throw new Error(
						"Gmail not connected — call maket_gmail connect first",
					);
			}
			const { google } = await import("googleapis");
			return google.gmail({ version: "v1", auth });
		},

		isConnected() {
			return connected;
		},

		grants() {
			return { draft: connected, read: connected && readGranted };
		},
	};

	(client as any)._testForceConnected = (withRead = false) => {
		connected = true;
		readGranted = withRead;
	};

	return client;
}
