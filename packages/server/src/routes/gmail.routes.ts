/**
 * gmail routes — Gmail credentials onboarding (paste the OAuth Desktop JSON
 * once, hit Connect, done) and a direct auth-URL redirect that bypasses the
 * MCP tool round-trip for users who walk the UI path.
 *
 * The paste form saves `google-credentials.json` into `config.DATA_DIR` in
 * the exact shape gmail-client.ts's `loadCredentials` expects (the
 * `{ installed: {...} }` object Google hands you from Cloud Console).
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import express, { Router as createRouter, type Router } from "express";
import { requireBrowserContextLoopback } from "../lib/local-origin.js";
import type { Config } from "../services/config.js";
import type { GmailClient } from "../services/gmail-client.js";

export interface GmailRouterDeps {
	config: Config;
	gmailClient: GmailClient;
}

/** Minimal HTML-escape for dynamic bits in the pages below. */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function shell(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
	body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; margin: 0; padding: 2rem 1rem; color: #1B263B; }
	main { max-width: 620px; margin: 0 auto; background: #fff; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
	h1 { font-size: 1.5rem; margin: 0 0 0.5rem; color: #0D1B2A; font-weight: 600; letter-spacing: -0.01em; }
	h1 .dot { color: #00A8B5; }
	p.lead { color: #415A77; margin: 0 0 1.5rem; line-height: 1.5; font-size: 0.95rem; }
	ol { color: #415A77; font-size: 0.9rem; line-height: 1.7; padding-left: 1.25rem; margin: 0 0 1.5rem; }
	ol a { color: #00A8B5; }
	label { display: block; font-size: 0.85rem; font-weight: 600; color: #1B263B; margin: 1rem 0 0.35rem; }
	textarea { width: 100%; box-sizing: border-box; min-height: 180px; font-family: "SF Mono", Menlo, monospace; font-size: 0.78rem; padding: 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; resize: vertical; background: #fafafa; color: #0D1B2A; }
	textarea:focus { outline: 2px solid #00A8B5; outline-offset: -1px; border-color: #00A8B5; }
	.opts { margin: 1rem 0; display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: #415A77; }
	button { background: #0D1B2A; color: #fff; border: 0; padding: 0.7rem 1.25rem; border-radius: 6px; font-weight: 600; font-size: 0.9rem; cursor: pointer; margin-top: 0.5rem; transition: background 0.15s; }
	button:hover { background: #1B263B; }
	button.secondary { background: #00A8B5; }
	button.secondary:hover { background: #0891b2; }
	.msg { margin: 1rem 0; padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.85rem; }
	.msg.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
	.msg.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
	.hint { font-size: 0.78rem; color: #94A3B8; margin-top: 0.35rem; }
	code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 0.82em; }
	.footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.78rem; color: #94A3B8; }
</style>
</head>
<body>
<main>${body}</main>
</body>
</html>`;
}

function formPage(opts: { error?: string } = {}): string {
	const error = opts.error
		? `<div class="msg err">${escapeHtml(opts.error)}</div>`
		: "";
	return shell(
		"Connect Gmail — Maket",
		`
		<h1>Connect Gmail<span class="dot">.</span></h1>
		<p class="lead">Paste the OAuth Desktop client JSON you downloaded from Google Cloud Console. Maket saves it locally (never in the repo) and uses it to create drafts in your Gmail. Maket never sends.</p>
		<ol>
			<li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Open Google Cloud Console → Credentials</a></li>
			<li>Create or open your OAuth 2.0 Client ID (type: <code>Desktop app</code>)</li>
			<li>Click <strong>Download JSON</strong></li>
			<li>Paste the file contents below</li>
		</ol>
		${error}
		<form method="POST" action="/api/gmail/credentials" id="form">
			<label for="credentials">Credentials JSON</label>
			<textarea id="credentials" name="credentials" placeholder='{ "installed": { "client_id": "...", "client_secret": "...", ... } }' required></textarea>
			<div class="hint">The file saves to <code>~/.maket/google-credentials.json</code> with owner-only permissions.</div>
			<label class="opts">
				<input type="checkbox" name="with_read" value="1">
				<span>Also request inbox reading (<code>gmail.readonly</code>) — lets the AI search your mail. Default is drafts only.</span>
			</label>
			<button type="submit">Save credentials</button>
		</form>
		<div class="footer">Maket creates drafts only — it never calls Gmail's send endpoint. Source: <code>packages/server/src/tools/gmail.ts</code>.</div>
	`,
	);
}

function successPage(withRead: boolean): string {
	const authUrl = `/api/gmail/auth-url${withRead ? "?with_read=1" : ""}`;
	return shell(
		"Credentials saved — Maket",
		`
		<h1>Saved<span class="dot">.</span></h1>
		<p class="lead">Your Gmail credentials are now stored locally. Hit the button below to authorise Maket with Google, or run <code>maket_gmail action=connect${withRead ? " with_read=true" : ""}</code> from your AI assistant.</p>
		<div class="msg ok">Credentials written to <code>$MAKET_DATA_DIR/google-credentials.json</code> (mode 0600).</div>
		<a href="${authUrl}"><button type="button" class="secondary">Connect to Gmail →</button></a>
		<div class="footer">You'll see Google's "unverified app" screen — that's expected for a self-hosted OSS tool. Click <strong>Advanced → Go to maket (unsafe)</strong> to proceed. The code is yours to audit.</div>
	`,
	);
}

function extractCredentials(raw: unknown): {
	installed: { client_id: string; client_secret: string };
} | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;

	const candidate = (obj.installed ?? obj.web ?? obj) as Record<
		string,
		unknown
	>;
	const client_id = candidate?.client_id;
	const client_secret = candidate?.client_secret;
	if (typeof client_id !== "string" || typeof client_secret !== "string") {
		return null;
	}
	return {
		installed: {
			client_id,
			client_secret,
			...(typeof candidate === "object" ? candidate : {}),
		},
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// HTTP handler for Gmail OAuth client JSON upload into the data dir.
function handleGmailCredentialsPost(
	config: GmailRouterDeps["config"],
	req: import("express").Request,
	res: import("express").Response,
) {
	const rawJson = req.body?.credentials;
	const withRead = req.body?.with_read === "1";
	if (typeof rawJson !== "string" || !rawJson.trim()) {
		return res
			.type("html")
			.status(400)
			.send(
				formPage({
					error: "Paste the JSON contents from the OAuth client you created.",
				}),
			);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson);
	} catch {
		return res
			.type("html")
			.status(400)
			.send(
				formPage({
					error:
						"That didn't parse as JSON. Make sure you pasted the full file content, braces included.",
				}),
			);
	}
	const creds = extractCredentials(parsed);
	if (!creds) {
		return res
			.type("html")
			.status(400)
			.send(
				formPage({
					error:
						"Missing `client_id` or `client_secret`. Expected a Desktop app JSON with an `installed` block.",
				}),
			);
	}
	const path = join(config.DATA_DIR, "google-credentials.json");
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
	renameSync(tmp, path);
	res.type("html").send(successPage(withRead));
}

export function createGmailRouter({
	config,
	gmailClient,
}: GmailRouterDeps): Router {
	const router = createRouter();

	router.use(requireBrowserContextLoopback);

	router.use(express.urlencoded({ extended: false, limit: "64kb" }));

	router.get("/setup/gmail", (_req, res) => {
		res.type("html").send(formPage());
	});

	router.post("/api/gmail/credentials", (req, res) => {
		handleGmailCredentialsPost(config, req, res);
	});

	router.get("/api/gmail/auth-url", async (req, res) => {
		try {
			const withRead = req.query.with_read === "1";
			const redirectUri = `http://localhost:${config.PORT}/auth/google/callback`;
			const url = await gmailClient.getAuthUrl(redirectUri, { withRead });
			res.redirect(302, url);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			res
				.type("html")
				.status(500)
				.send(
					shell(
						"Gmail setup — error",
						`<h1>Setup error<span class="dot">.</span></h1>
					<div class="msg err">${escapeHtml(msg)}</div>
					<p class="lead"><a href="/setup/gmail">Return to setup →</a></p>`,
					),
				);
		}
	});

	return router;
}
