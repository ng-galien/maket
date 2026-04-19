import { describe, expect, it } from "vitest";
import { createGmailClient, loadCredentials } from "./gmail-client.js";

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
		// biome-ignore lint/suspicious/noExplicitAny: internal state probe
		(a as any)._testForceConnected();
		expect(a.isConnected()).toBe(true);
		expect(b.isConnected()).toBe(false);
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
