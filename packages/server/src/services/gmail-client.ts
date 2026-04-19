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

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCOPES = [
	"https://www.googleapis.com/auth/gmail.compose",
	"https://www.googleapis.com/auth/gmail.readonly",
];

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

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
	handleCallback(code: string, redirectUri: string): Promise<string>;
	// biome-ignore lint/suspicious/noExplicitAny: googleapis type resolved lazily
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

	// biome-ignore lint/suspicious/noExplicitAny: OAuth2 client typed lazily
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

	function saveToken(
		clientId: string,
		clientSecret: string,
		refreshToken: string,
	): void {
		const payload = JSON.stringify({
			type: "authorized_user",
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
		});
		const tmpPath = `${tokenPath}.tmp`;
		writeFileSync(tmpPath, payload, { mode: 0o600 });
		renameSync(tmpPath, tokenPath);
	}

	const client: GmailClient = {
		async tryRestore() {
			if (connected) return true;
			if (!existsSync(tokenPath)) return false;
			const { google } = await import("googleapis");
			const data = JSON.parse(readFileSync(tokenPath, "utf-8"));
			auth = google.auth.fromJSON(data);
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

		async handleCallback(code: string, redirectUri: string) {
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
				saveToken(creds.client_id, creds.client_secret, tokens.refresh_token);
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
	// biome-ignore lint/suspicious/noExplicitAny: test-only probe
	(client as any)._testForceConnected = () => {
		connected = true;
	};

	return client;
}
