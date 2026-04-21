import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../../tests/helpers.js";
import type { Config } from "../services/config.js";
import type { GmailClient } from "../services/gmail-client.js";
import { createOAuthRouter } from "./oauth.routes.js";

describe("oauth routes", () => {
	let gmailClient: GmailClient;
	let baseUrl: string;
	let close: () => Promise<void>;

	beforeEach(async () => {
		gmailClient = {
			handleCallback: vi.fn(),
		} as unknown as GmailClient;
		const config = { PORT: 3333 } as Config;
		const app = express();
		app.use(createOAuthRouter({ config, gmailClient }));
		({ baseUrl, close } = await startTestApp(app));
	});

	afterEach(async () => {
		await close();
	});

	it("400s when code is missing", async () => {
		const res = await fetch(`${baseUrl}/auth/google/callback?state=s`);
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/Missing authorization code/);
	});

	it("400s when state is missing", async () => {
		const res = await fetch(`${baseUrl}/auth/google/callback?code=c`);
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/Missing state parameter/);
	});

	it("renders the success page and escapes the Gmail address", async () => {
		vi.mocked(gmailClient.handleCallback).mockResolvedValueOnce(
			`test+<x>@example.com`,
		);

		const res = await fetch(`${baseUrl}/auth/google/callback?code=c&state=s`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(gmailClient.handleCallback).toHaveBeenCalledWith(
			"c",
			"s",
			"http://localhost:3333/auth/google/callback",
		);
		expect(html).toContain("Gmail connected");
		expect(html).toContain("test+&lt;x&gt;@example.com");
	});

	it("renders an escaped failure page on callback errors", async () => {
		vi.mocked(gmailClient.handleCallback).mockRejectedValueOnce(
			new Error(`bad <state>`),
		);

		const res = await fetch(`${baseUrl}/auth/google/callback?code=c&state=s`);
		expect(res.status).toBe(500);
		const html = await res.text();
		expect(html).toContain("Connection failed");
		expect(html).toContain("bad &lt;state&gt;");
	});
});
