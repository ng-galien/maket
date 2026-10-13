/**
 * Wait for a puppeteer page to reach a visually stable layout before
 * measuring or rasterising it.
 *
 * `document.fonts.ready` alone is insufficient: it resolves once font files
 * are downloaded, but Chromium still needs to decode embedded images and
 * commit the post-swap layout pass before metrics like
 * `Element.getBoundingClientRect()` reflect the final rendered state. An
 * unloaded `<img>` reports `naturalHeight === 0`, the layout walker silently
 * agrees the page fits, and the rendered PDF / screenshot disagrees with
 * what the agent thinks shipped. See puppeteer/puppeteer#422.
 *
 * Procedure:
 *  1. Wait until the network is idle after the page load. Puppeteer 25 no
 *     longer accepts `networkidle0` as a `setContent` lifecycle event.
 *  2. Run `document.fonts.ready` and `image.decode()` for every `<img>` in
 *     parallel — they're independent (decode resolves pixel data, font
 *     loading resolves text metrics; neither blocks the other).
 *  3. Pump two `requestAnimationFrame` ticks. The first lets Chromium flush
 *     pending layout invalidations triggered by the just-resolved fonts /
 *     images; the second ensures we sample after that frame has committed.
 *     A hidden window may never tick a frame, so a forced layout read and a
 *     timer bound the pump.
 *
 * Network idle and the in-page wait each carry a deadline; a passed deadline
 * rejects with a `RenderTimeoutError` naming the step.
 */

import type { RenderPage } from "../services/browser-pool.js";
import { withDeadline } from "./render-deadline.js";

export const PAGE_BLOCK_SELECTOR = '[data-id="page"]';

export interface PageStableTimeouts {
	networkIdleMs: number;
	pageStableMs: number;
	framePumpMs: number;
}

export const PAGE_STABLE_TIMEOUTS: PageStableTimeouts = {
	networkIdleMs: 15_000,
	pageStableMs: 10_000,
	framePumpMs: 250,
};

export async function waitForPageStable(
	page: RenderPage,
	timeouts: PageStableTimeouts = PAGE_STABLE_TIMEOUTS,
): Promise<void> {
	await withDeadline(
		page.waitForNetworkIdle(),
		timeouts.networkIdleMs,
		"network idle",
	);
	await withDeadline(
		page.evaluate(async (framePumpMs: number) => {
			await Promise.all([
				document.fonts.ready,
				...[...document.images].map((img) =>
					img.decode().catch(() => undefined),
				),
			]);
			document.body?.getBoundingClientRect();
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, framePumpMs);
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						clearTimeout(timer);
						resolve();
					}),
				);
			});
		}, timeouts.framePumpMs),
		timeouts.pageStableMs,
		"page stable",
	);
}
