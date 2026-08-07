import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createGmailClient, loadCredentials } from "./gmail-client.js";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("createGmailClient", () => {
	it("starts disconnected", () => {
		const client = createGmailClient({
			dataDir: "/tmp/test",
			env: {},
		});
		expect(client.isConnected()).toBe(false);
	});

	it("instances are isolated (no shared module state)", () => {
		const a = createGmailClient({ dataDir: "/tmp/a", env: {} });
		const b = createGmailClient({ dataDir: "/tmp/b", env: {} });
		(a as any)._testForceConnected();
		expect(a.isConnected()).toBe(true);
		expect(b.isConnected()).toBe(false);
	});

	it("default grants: draft when connected, no read", () => {
		const client = createGmailClient({ dataDir: "/tmp/test", env: {} });
		expect(client.grants()).toEqual({ draft: false, read: false });
		(client as any)._testForceConnected();
		expect(client.grants()).toEqual({ draft: true, read: false });
	});

	it("read grant propagates when explicitly forced on", () => {
		const client = createGmailClient({ dataDir: "/tmp/test", env: {} });
		(client as any)._testForceConnected(true);
		expect(client.grants()).toEqual({ draft: true, read: true });
	});

	it("builds a consent URL and exchanges the callback through native fetch", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-gmail-client-"));
		try {
			const fetchMock = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(
					jsonResponse({
						access_token: "access-1",
						refresh_token: "refresh-1",
						expires_in: 3600,
						scope:
							"https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly",
					}),
				)
				.mockResolvedValueOnce(
					jsonResponse({ emailAddress: "me@example.com" }),
				);
			const client = createGmailClient(
				{
					dataDir,
					env: {
						GOOGLE_CLIENT_ID: "client-id",
						GOOGLE_CLIENT_SECRET: "client-secret",
					},
				},
				{ fetch: fetchMock, now: () => 1_000_000 },
			);

			const redirectUri = "http://localhost:24842/auth/google/callback";
			const authUrl = new URL(
				await client.getAuthUrl(redirectUri, { withRead: true }),
			);
			expect(authUrl.origin).toBe("https://accounts.google.com");
			expect(authUrl.searchParams.get("client_id")).toBe("client-id");
			expect(authUrl.searchParams.get("scope")).toContain("gmail.readonly");
			const state = authUrl.searchParams.get("state");
			expect(state).toBeTruthy();

			await expect(
				client.handleCallback("auth-code", state as string, redirectUri),
			).resolves.toBe("me@example.com");
			expect(client.grants()).toEqual({ draft: true, read: true });

			const tokenRequest = fetchMock.mock.calls[0];
			expect(tokenRequest?.[0]).toBe("https://oauth2.googleapis.com/token");
			expect(String(tokenRequest?.[1]?.body)).toContain(
				"grant_type=authorization_code",
			);
			expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
				expect.objectContaining({ authorization: "Bearer access-1" }),
			);
			expect(
				JSON.parse(readFileSync(join(dataDir, "google-token.json"), "utf-8")),
			).toEqual({ refresh_token: "refresh-1", with_read: true });
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});

	it("refreshes a restored token and preserves Gmail REST request shapes", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-gmail-client-"));
		try {
			writeFileSync(
				join(dataDir, "google-token.json"),
				JSON.stringify({ refresh_token: "refresh-saved", with_read: false }),
			);
			const fetchMock = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(
					jsonResponse({ access_token: "access-2", expires_in: 3600 }),
				)
				.mockResolvedValueOnce(jsonResponse({ id: "draft-1" }));
			const client = createGmailClient(
				{
					dataDir,
					env: {
						GOOGLE_CLIENT_ID: "client-id",
						GOOGLE_CLIENT_SECRET: "client-secret",
					},
				},
				{ fetch: fetchMock, now: () => 1_000_000 },
			);

			await expect(client.tryRestore()).resolves.toBe(true);
			const gmail = await client.getGmail();
			await gmail.users.drafts.create({
				userId: "me",
				requestBody: { message: { raw: "abc" } },
			});

			expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
				"refresh_token=refresh-saved",
			);
			expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
				"https://gmail.googleapis.com/gmail/v1/users/me/drafts",
			);
			expect(fetchMock.mock.calls[1]?.[1]).toEqual(
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ message: { raw: "abc" } }),
				}),
			);
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});

	it("rejects an expired saved grant so connect can start fresh OAuth", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-gmail-client-"));
		try {
			writeFileSync(
				join(dataDir, "google-token.json"),
				JSON.stringify({ refresh_token: "expired", with_read: true }),
			);
			const fetchMock = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(
					jsonResponse(
						{ error: "invalid_grant", error_description: "revoked" },
						400,
					),
				);
			const client = createGmailClient(
				{
					dataDir,
					env: {
						GOOGLE_CLIENT_ID: "client-id",
						GOOGLE_CLIENT_SECRET: "client-secret",
					},
				},
				{ fetch: fetchMock },
			);

			await expect(client.tryRestore()).resolves.toBe(false);
			expect(client.isConnected()).toBe(false);
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});

	it("refreshes once and retries when Gmail rejects a cached access token", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-gmail-client-"));
		try {
			writeFileSync(
				join(dataDir, "google-token.json"),
				JSON.stringify({ refresh_token: "refresh-saved", with_read: false }),
			);
			const fetchMock = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(
					jsonResponse({ access_token: "access-old", expires_in: 3600 }),
				)
				.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
				.mockResolvedValueOnce(
					jsonResponse({ access_token: "access-new", expires_in: 3600 }),
				)
				.mockResolvedValueOnce(
					jsonResponse({ emailAddress: "me@example.com" }),
				);
			const client = createGmailClient(
				{
					dataDir,
					env: {
						GOOGLE_CLIENT_ID: "client-id",
						GOOGLE_CLIENT_SECRET: "client-secret",
					},
				},
				{ fetch: fetchMock, now: () => 1_000_000 },
			);

			await expect(client.tryRestore()).resolves.toBe(true);
			const gmail = await client.getGmail();
			await expect(gmail.users.getProfile({ userId: "me" })).resolves.toEqual({
				data: { emailAddress: "me@example.com" },
			});
			expect(fetchMock).toHaveBeenCalledTimes(4);
			expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
				expect.objectContaining({ authorization: "Bearer access-old" }),
			);
			expect(fetchMock.mock.calls[3]?.[1]?.headers).toEqual(
				expect.objectContaining({ authorization: "Bearer access-new" }),
			);
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});
});

describe("loadCredentials", () => {
	it("uses env vars when both are set", () => {
		const creds = loadCredentials({
			env: {
				GOOGLE_CLIENT_ID: "id-env",
				GOOGLE_CLIENT_SECRET: "secret-env",
			},
			readFile: () => {
				throw new Error("should not read file");
			},
			exists: () => false,
		});
		expect(creds).toEqual({ client_id: "id-env", client_secret: "secret-env" });
	});

	it("falls back to a JSON file when env vars are missing", () => {
		const creds = loadCredentials({
			env: {},
			readFile: () =>
				JSON.stringify({
					installed: { client_id: "id-file", client_secret: "secret-file" },
				}),
			exists: () => true,
			credentialsPath: "/tmp/creds.json",
		});
		expect(creds).toEqual({
			client_id: "id-file",
			client_secret: "secret-file",
		});
	});

	it("supports `web` key in the JSON file (OAuth2 web clients)", () => {
		const creds = loadCredentials({
			env: {},
			readFile: () =>
				JSON.stringify({
					web: { client_id: "id-web", client_secret: "secret-web" },
				}),
			exists: () => true,
			credentialsPath: "/tmp/creds.json",
		});
		expect(creds.client_id).toBe("id-web");
	});

	it("throws a helpful error when no credentials are available", () => {
		expect(() =>
			loadCredentials({
				env: {},
				readFile: () => {
					throw new Error("no file");
				},
				exists: () => false,
			}),
		).toThrow(/Google credentials not found/);
	});

	it("partial env (only id, no secret) falls through to file lookup", () => {
		const creds = loadCredentials({
			env: { GOOGLE_CLIENT_ID: "only-id" },
			readFile: () =>
				JSON.stringify({
					installed: { client_id: "id-file", client_secret: "secret-file" },
				}),
			exists: () => true,
			credentialsPath: "/tmp/creds.json",
		});
		expect(creds.client_id).toBe("id-file");
	});
});
