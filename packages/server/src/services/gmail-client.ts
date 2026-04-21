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

const SCOPES = [
	"https://www.googleapis.com/auth/gmail.compose",
	"https://www.googleapis.com/auth/gmail.readonly",
];

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
				"Option 1: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env\n" +
				`Option 2: Place credentials JSON at ${path || "<unset>"}`,
		);
	}
	const keys = JSON.parse(readFile(path));
	return keys.installed || keys.web;
}

export interface GmailClient {
	tryRestore(): Promise<boolean>;
	getAuthUrl(redirectUri: string): Promise<string>;
	startAuth(): Promise<void>;
	handleCallback(
		code: string,
		state: string,
		redirectUri: string,
	): Promise<string>;
	getGmail(): Promise<any>;
	isConnected(): boolean;
}

export interface GmailClientInputs {
	dataDir: string;
	env?: Record<string, string | undefined>;
}

export function createGmailClient(inputs: GmailClientInputs): GmailClient {
	const env = inputs.env ?? process.env;
	const credentialsPath = join(inputs.dataDir, "google-credentials.json");
	const tokenPath = join(inputs.dataDir, "google-token.json");

	let auth: any = null;
	let connected = false;
	let pendingResolve: (() => void) | null = null;
	let pendingReject: ((err: Error) => void) | null = null;

	const resolveCreds = () =>
		loadCredentials({
			env,
			readFile: (p) => readFileSync(p, "utf-8"),
			exists: existsSync,
			credentialsPath,
		});

	// Pending OAuth state nonces — used to bind a browser session to its callback.
	// Without this, anyone who can reach `/auth/google/callback` (e.g. via DNS
	// rebinding or a top-level navigation from a hostile site) could swap in a
	// different account's authorization code.
	const pendingStates = new Map<string, number>();
	function newState(): string {
		const s = randomBytes(32).toString("base64url");
		pendingStates.set(s, Date.now() + STATE_TTL_MS);
		// Lazy GC of expired entries.
		const now = Date.now();
		for (const [k, t] of pendingStates) {
			if (t < now) pendingStates.delete(k);
		}
		return s;
	}
	function consumeState(s: string): boolean {
		const t = pendingStates.get(s);
		if (!t || t < Date.now()) {
			pendingStates.delete(s);
			return false;
		}
		pendingStates.delete(s);
		return true;
	}

	function saveToken(refreshToken: string): void {
		// Only the refresh token is persisted; client_id/client_secret stay in
		// env or the credentials file. This keeps `google-token.json` from
		// being a one-stop credential dump if the data dir leaks.
		const payload = JSON.stringify({ refresh_token: refreshToken });
		const tmpPath = `${tokenPath}.tmp`;
		writeFileSync(tmpPath, payload, { mode: 0o600 });
		renameSync(tmpPath, tokenPath);
	}

	const client: GmailClient = {
		async tryRestore() {
			if (connected) return true;
			if (!existsSync(tokenPath)) return false;
			let data: unknown;
			try {
				data = JSON.parse(readFileSync(tokenPath, "utf-8"));
			} catch {
				return false;
			}
			const refreshToken =
				data &&
				typeof data === "object" &&
				typeof (data as { refresh_token?: unknown }).refresh_token === "string"
					? (data as { refresh_token: string }).refresh_token
					: null;
			if (!refreshToken) return false;
			const { google } = await import("googleapis");
			const creds = resolveCreds();
			const oauth2 = new google.auth.OAuth2(
				creds.client_id,
				creds.client_secret,
			);
			oauth2.setCredentials({ refresh_token: refreshToken });
			auth = oauth2;
			connected = true;
			return true;
		},

		async getAuthUrl(redirectUri: string) {
			const { google } = await import("googleapis");
			const creds = resolveCreds();
			const oauth2 = new google.auth.OAuth2(
				creds.client_id,
				creds.client_secret,
				redirectUri,
			);
			return oauth2.generateAuthUrl({
				access_type: "offline",
				scope: SCOPES,
				prompt: "consent",
				state: newState(),
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

		async handleCallback(code: string, state: string, redirectUri: string) {
			if (!consumeState(state)) {
				throw new Error(
					"Invalid or expired OAuth state — restart the connect flow",
				);
			}
			const { google } = await import("googleapis");
			const creds = resolveCreds();
			const oauth2 = new google.auth.OAuth2(
				creds.client_id,
				creds.client_secret,
				redirectUri,
			);
			const { tokens } = await oauth2.getToken(code);
			oauth2.setCredentials(tokens);
			if (tokens.refresh_token) {
				saveToken(tokens.refresh_token);
			}
			auth = oauth2;
			connected = true;
			if (pendingResolve) {
				pendingResolve();
				pendingResolve = null;
				pendingReject = null;
			}
			const gmail = google.gmail({ version: "v1", auth: oauth2 });
			const profile = await gmail.users.getProfile({ userId: "me" });
			return profile.data.emailAddress || "";
		},

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
	};

	// Testing hatch — exposed as `any` for unit tests, never used in production.
	(client as any)._testForceConnected = () => {
		connected = true;
	};

	return client;
}
