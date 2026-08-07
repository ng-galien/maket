/**
 * gmail-client — OAuth2 + Gmail REST wrapper.
 *
 * State (auth, connected, pending OAuth callback) lives inside a closure so
 * instances are isolated and testable. Credentials are resolved via env first,
 * JSON file second — both sources are injectable for tests.
 *
 * Node's native fetch covers the small Google API surface Maket needs. Keeping
 * this adapter local avoids pulling the full googleapis dependency tree.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DRAFT_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const STATE_TTL_MS = OAUTH_TIMEOUT_MS;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_EXPIRY_SKEW_MS = 30_000;

function buildScopes(withRead: boolean): string[] {
	return withRead ? [DRAFT_SCOPE, READ_SCOPE] : [DRAFT_SCOPE];
}

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

export interface GmailClientOptions {
	fetch?: typeof fetch;
	now?: () => number;
}

interface SavedToken {
	refreshToken: string;
	withRead: boolean;
}

interface OAuthSession {
	credentials: Credentials;
	refreshToken?: string;
	accessToken?: string;
	expiresAt?: number;
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	error?: string;
	error_description?: string;
}

class GoogleApiError extends Error {
	constructor(
		readonly status: number,
		readonly body: unknown,
	) {
		super(
			`Google API returned ${status}: ${typeof body === "object" ? JSON.stringify(body) : String(body)}`,
		);
	}
}

function isInvalidGrant(error: unknown): boolean {
	return (
		error instanceof GoogleApiError &&
		typeof error.body === "object" &&
		error.body !== null &&
		(error.body as { error?: unknown }).error === "invalid_grant"
	);
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
			for (const [key, expiresAt] of pendingStates) {
				if (expiresAt < now) pendingStates.delete(key);
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

function appendQuery(url: URL, params: Record<string, unknown>): void {
	for (const [key, raw] of Object.entries(params)) {
		if (raw == null) continue;
		const values = Array.isArray(raw) ? raw : [raw];
		for (const value of values) url.searchParams.append(key, String(value));
	}
}

async function readJsonResponse<T>(response: Response): Promise<T> {
	const text = await response.text();
	let body: unknown = {};
	if (text) {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	if (!response.ok) {
		throw new GoogleApiError(response.status, body);
	}
	return body as T;
}

async function requestToken(
	fetchImpl: typeof fetch,
	params: Record<string, string>,
): Promise<TokenResponse> {
	const response = await fetchImpl(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params),
	});
	const token = await readJsonResponse<TokenResponse>(response);
	if (!token.access_token) {
		throw new Error(
			token.error_description ||
				token.error ||
				"OAuth response missing access_token",
		);
	}
	return token;
}

async function ensureAccessToken(ctx: {
	session: OAuthSession;
	fetch: typeof fetch;
	now: () => number;
}): Promise<string> {
	if (
		ctx.session.accessToken &&
		(ctx.session.expiresAt ?? 0) > ctx.now() + TOKEN_EXPIRY_SKEW_MS
	) {
		return ctx.session.accessToken;
	}
	if (!ctx.session.refreshToken) {
		if (ctx.session.accessToken) return ctx.session.accessToken;
		throw new Error("Google OAuth session has no refresh token");
	}
	const token = await requestToken(ctx.fetch, {
		client_id: ctx.session.credentials.client_id,
		client_secret: ctx.session.credentials.client_secret,
		refresh_token: ctx.session.refreshToken,
		grant_type: "refresh_token",
	});
	ctx.session.accessToken = token.access_token;
	ctx.session.expiresAt =
		ctx.now() + Math.max(0, token.expires_in ?? 3600) * 1000;
	return token.access_token as string;
}

function createGmailApi(ctx: {
	session: OAuthSession;
	fetch: typeof fetch;
	now: () => number;
}) {
	async function call<T>(
		method: "GET" | "POST",
		path: string,
		query: Record<string, unknown> = {},
		body?: unknown,
	): Promise<{ data: T }> {
		const url = new URL(`${GMAIL_API}${path}`);
		appendQuery(url, query);
		const requestBody = body === undefined ? undefined : JSON.stringify(body);
		const send = async () =>
			ctx.fetch(url, {
				method,
				headers: {
					authorization: `Bearer ${await ensureAccessToken(ctx)}`,
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				body: requestBody,
			});
		let response = await send();
		if (response.status === 401 && ctx.session.refreshToken) {
			ctx.session.accessToken = undefined;
			ctx.session.expiresAt = undefined;
			response = await send();
		}
		return { data: await readJsonResponse<T>(response) };
	}

	return {
		users: {
			getProfile: ({ userId }: { userId: string }) =>
				call<{ emailAddress?: string }>(
					"GET",
					`/users/${encodeURIComponent(userId)}/profile`,
				),
			messages: {
				list: ({ userId, ...query }: Record<string, unknown>) =>
					call<{ messages?: { id?: string }[] }>(
						"GET",
						`/users/${encodeURIComponent(String(userId))}/messages`,
						query,
					),
				get: ({ userId, id, ...query }: Record<string, unknown>) =>
					call<unknown>(
						"GET",
						`/users/${encodeURIComponent(String(userId))}/messages/${encodeURIComponent(String(id))}`,
						query,
					),
				attachments: {
					get: ({ userId, messageId, id }: Record<string, unknown>) =>
						call<unknown>(
							"GET",
							`/users/${encodeURIComponent(String(userId))}/messages/${encodeURIComponent(String(messageId))}/attachments/${encodeURIComponent(String(id))}`,
						),
				},
			},
			drafts: {
				create: ({ userId, requestBody }: Record<string, unknown>) =>
					call<unknown>(
						"POST",
						`/users/${encodeURIComponent(String(userId))}/drafts`,
						{},
						requestBody,
					),
			},
		},
	};
}

// code-moniker: ignore[smell-feature-envy-local]
// OAuth callback: state check, token exchange, profile lookup, token persist.
async function completeGmailOAuthCallback(ctx: {
	code: string;
	state: string;
	redirectUri: string;
	consumeState: (state: string) => boolean;
	resolveCreds: () => Credentials;
	tokenPath: string;
	fetch: typeof fetch;
	now: () => number;
	setAuth: (auth: OAuthSession) => void;
	setConnected: (value: boolean) => void;
	setReadGranted: (value: boolean) => void;
	clearPending: () => void;
}): Promise<string> {
	if (!ctx.consumeState(ctx.state)) {
		throw new Error(
			"Invalid or expired OAuth state — restart the connect flow",
		);
	}
	const credentials = ctx.resolveCreds();
	const tokens = await requestToken(ctx.fetch, {
		client_id: credentials.client_id,
		client_secret: credentials.client_secret,
		code: ctx.code,
		redirect_uri: ctx.redirectUri,
		grant_type: "authorization_code",
	});
	const grantedScopes =
		typeof tokens.scope === "string" ? tokens.scope.split(" ") : [];
	const withRead = grantedScopes.includes(READ_SCOPE);
	ctx.setReadGranted(withRead);
	if (tokens.refresh_token) {
		writeSavedToken(ctx.tokenPath, tokens.refresh_token, withRead);
	}
	const session: OAuthSession = {
		credentials,
		refreshToken: tokens.refresh_token,
		accessToken: tokens.access_token,
		expiresAt: ctx.now() + Math.max(0, tokens.expires_in ?? 3600) * 1000,
	};
	ctx.setAuth(session);
	ctx.setConnected(true);
	ctx.clearPending();
	const gmail = createGmailApi({ session, fetch: ctx.fetch, now: ctx.now });
	const profile = await gmail.users.getProfile({ userId: "me" });
	return profile.data.emailAddress || "";
}

export function createGmailClient(
	inputs: GmailClientInputs,
	opts: GmailClientOptions = {},
): GmailClient {
	const env = inputs.env ?? process.env;
	const fetchImpl = opts.fetch ?? fetch;
	const now = opts.now ?? Date.now;
	const credentialsPath = join(inputs.dataDir, "google-credentials.json");
	const tokenPath = join(inputs.dataDir, "google-token.json");
	const oauthStates = createOAuthStateStore();

	let auth: OAuthSession | null = null;
	let connected = false;
	let readGranted = false;
	let pendingResolve: (() => void) | null = null;
	let pendingReject: ((err: Error) => void) | null = null;

	const resolveCreds = () =>
		loadCredentials({
			env,
			readFile: (path) => readFileSync(path, "utf-8"),
			exists: existsSync,
			credentialsPath,
		});

	const client: GmailClient = {
		async tryRestore() {
			if (connected) return true;
			const saved = readSavedToken(tokenPath);
			if (!saved) return false;
			const restored: OAuthSession = {
				credentials: resolveCreds(),
				refreshToken: saved.refreshToken,
			};
			try {
				await ensureAccessToken({
					session: restored,
					fetch: fetchImpl,
					now,
				});
			} catch (error) {
				if (isInvalidGrant(error)) return false;
				throw error;
			}
			auth = restored;
			connected = true;
			readGranted = saved.withRead;
			return true;
		},

		async getAuthUrl(redirectUri, options) {
			const url = new URL(AUTH_URL);
			appendQuery(url, {
				client_id: resolveCreds().client_id,
				redirect_uri: redirectUri,
				response_type: "code",
				access_type: "offline",
				scope: buildScopes(options?.withRead === true).join(" "),
				prompt: "consent",
				state: oauthStates.newState(),
			});
			return url.toString();
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
				consumeState: (candidate) => oauthStates.consumeState(candidate),
				resolveCreds,
				tokenPath,
				fetch: fetchImpl,
				now,
				setAuth: (session) => {
					auth = session;
				},
				setConnected: (value) => {
					connected = value;
				},
				setReadGranted: (value) => {
					readGranted = value;
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
				if (!restored) {
					throw new Error(
						"Gmail not connected — call maket_gmail connect first",
					);
				}
			}
			const session = auth;
			if (!session) throw new Error("Gmail OAuth session is unavailable");
			return createGmailApi({ session, fetch: fetchImpl, now });
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
