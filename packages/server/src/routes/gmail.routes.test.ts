import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../../tests/helpers.js";
import type { Config } from "../services/config.js";
import type { GmailClient } from "../services/gmail-client.js";
import { createGmailRouter } from "./gmail.routes.js";

describe("gmail routes — onboarding + auth-url", () => {
	let dataDir: string;
	let baseUrl: string;
	let close: () => Promise<void>;
	let gmailClient: GmailClient;

	beforeEach(async () => {
		dataDir = mkdtempSync(join(tmpdir(), "maket-gmail-route-"));
		gmailClient = {
			getAuthUrl: vi.fn(
				async (_redirect, opts) =>
					`https://accounts.google.com/o/oauth2/auth?with_read=${opts?.withRead ? "1" : "0"}`,
			),
		} as unknown as GmailClient;
		const config = { DATA_DIR: dataDir, PORT: 24842 } as Config;
		const app = express();
		app.use(createGmailRouter({ config, gmailClient }));
		({ baseUrl, close } = await startTestApp(app));
	});

	afterEach(async () => {
		await close();
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("GET /setup/gmail returns the paste form", async () => {
		const res = await fetch(`${baseUrl}/setup/gmail`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const html = await res.text();
		expect(html).toMatch(/Connect Gmail/);
		expect(html).toMatch(/name="credentials"/);
		expect(html).toMatch(/action="\/api\/gmail\/credentials"/);
	});

	it("POST /api/gmail/credentials saves the Desktop JSON and serves a success page", async () => {
		const body = new URLSearchParams({
			credentials: JSON.stringify({
				installed: {
					client_id: "id-xyz",
					client_secret: "secret-xyz",
					redirect_uris: ["http://localhost"],
				},
			}),
		});
		const res = await fetch(`${baseUrl}/api/gmail/credentials`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toMatch(/Saved/);
		expect(html).toMatch(/\/api\/gmail\/auth-url/);
		const saved = join(dataDir, "google-credentials.json");
		expect(existsSync(saved)).toBe(true);
		const parsed = JSON.parse(readFileSync(saved, "utf-8"));
		expect(parsed.installed.client_id).toBe("id-xyz");
		expect(parsed.installed.client_secret).toBe("secret-xyz");
	});

	it("POST accepts the `web` key shape (not just `installed`)", async () => {
		const body = new URLSearchParams({
			credentials: JSON.stringify({
				web: { client_id: "web-id", client_secret: "web-secret" },
			}),
		});
		const res = await fetch(`${baseUrl}/api/gmail/credentials`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		expect(res.status).toBe(200);
		const saved = JSON.parse(
			readFileSync(join(dataDir, "google-credentials.json"), "utf-8"),
		);
		expect(saved.installed.client_id).toBe("web-id");
	});

	it("POST renders the form with an error when JSON is malformed", async () => {
		const body = new URLSearchParams({ credentials: "{ not json" });
		const res = await fetch(`${baseUrl}/api/gmail/credentials`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		expect(res.status).toBe(400);
		const html = await res.text();
		// The apostrophe in "didn't" is HTML-escaped to &#39; when rendered.
		expect(html).toMatch(/didn(?:'|&#39;)t parse as JSON/);
	});

	it("POST renders the form with an error when client_id or secret is missing", async () => {
		const body = new URLSearchParams({
			credentials: JSON.stringify({ installed: { client_id: "only-id" } }),
		});
		const res = await fetch(`${baseUrl}/api/gmail/credentials`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		expect(res.status).toBe(400);
		const html = await res.text();
		expect(html).toMatch(/Missing `client_id` or `client_secret`/);
	});

	it("GET /api/gmail/auth-url redirects to Google with the drafts-only scope by default", async () => {
		const res = await fetch(`${baseUrl}/api/gmail/auth-url`, {
			redirect: "manual",
		});
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toMatch(/with_read=0$/);
		expect(gmailClient.getAuthUrl).toHaveBeenCalledWith(
			"http://localhost:24842/auth/google/callback",
			{ withRead: false },
		);
	});

	it("GET /api/gmail/auth-url?with_read=1 propagates the withRead option", async () => {
		const res = await fetch(`${baseUrl}/api/gmail/auth-url?with_read=1`, {
			redirect: "manual",
		});
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toMatch(/with_read=1$/);
		expect(gmailClient.getAuthUrl).toHaveBeenCalledWith(
			"http://localhost:24842/auth/google/callback",
			{ withRead: true },
		);
	});
});
