/**
 * oauth routes — Google OAuth callback; completes the refresh-token exchange
 * started by `gmail_connect`.
 */

import { Router as createRouter, type Router } from "express";
import type { Config } from "../services/config.js";
import type { GmailClient } from "../services/gmail-client.js";

export interface OAuthRouterDeps {
	config: Config;
	gmailClient: GmailClient;
}

/** Minimal HTML-escape — covers the five chars needed inside element text and
 *  attribute values. Used for the dynamic bits of the callback's response. */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function createOAuthRouter({
	config,
	gmailClient,
}: OAuthRouterDeps): Router {
	const router = createRouter();

	router.get("/auth/google/callback", async (req, res) => {
		const code = typeof req.query.code === "string" ? req.query.code : "";
		const state = typeof req.query.state === "string" ? req.query.state : "";
		if (!code) return res.status(400).send("Missing authorization code");
		if (!state) return res.status(400).send("Missing state parameter");

		try {
			const redirectUri = `http://localhost:${config.PORT}/auth/google/callback`;
			const email = await gmailClient.handleCallback(code, state, redirectUri);
			res.send(`<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5">
      <div style="text-align:center"><h2 style="color:#2C1810">Gmail connected</h2><p>${escapeHtml(email)}</p><p style="color:#888">You can close this tab.</p></div>
    </body></html>`);
			// biome-ignore lint/suspicious/noExplicitAny: error shape varies
		} catch (e: any) {
			const msg = escapeHtml(String(e?.message ?? "Unknown error"));
			res
				.status(500)
				.send(`<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5">
      <div style="text-align:center"><h2 style="color:#c00">Connection failed</h2><p>${msg}</p></div>
    </body></html>`);
		}
	});

	return router;
}
