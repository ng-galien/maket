/**
 * browser-pool — lazy-singleton puppeteer Browser shared between PdfService
 * and ThumbnailService.
 *
 * Puppeteer's launch cost (~800 ms) dwarfs the actual render for small jobs
 * like thumbnails, so we keep one browser across calls and lazy-relaunch if
 * it disconnects (crashed headless process, hot-reload, etc.).
 *
 * Tests pass a `launch` override returning a mock Browser.
 */

import puppeteer, { type Browser } from "puppeteer";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";

export interface BrowserPool {
	/** Returns the shared Browser, launching it on first use or after a
	 * disconnect. */
	get(): Promise<Browser>;
	/** Closes the underlying browser, if any. Awilix calls this at shutdown. */
	dispose(): Promise<void>;
}

export interface BrowserPoolOptions {
	/** Override puppeteer.launch — tests inject a mocked Browser factory. */
	launch?: () => Promise<Browser>;
}

export function createBrowserPool(
	_deps: Record<string, unknown> = {},
	opts: BrowserPoolOptions = {},
): BrowserPool {
	const launch =
		opts.launch ??
		(() =>
			puppeteer.launch({
				headless: CHROMIUM_HEADLESS,
				args: shouldDisableSandbox() ? ["--no-sandbox"] : [],
			}));

	let current: Browser | null = null;
	let pending: Promise<Browser> | null = null;

	return {
		async get() {
			if (current?.connected) return current;
			if (!pending) {
				pending = (async () => {
					const b = await launch();
					b.on("disconnected", () => {
						if (current === b) current = null;
					});
					current = b;
					return b;
				})().finally(() => {
					pending = null;
				});
			}
			return pending;
		},
		async dispose() {
			const b = current;
			current = null;
			if (b?.connected) {
				await b.close().catch(() => {});
			}
		},
	};
}
