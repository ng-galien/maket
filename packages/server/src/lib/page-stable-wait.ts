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
 */

import type { Page } from "puppeteer";

export const PAGE_BLOCK_SELECTOR = '[data-id="page"]';

export async function waitForPageStable(page: Page): Promise<void> {
	await page.waitForNetworkIdle();
	await page.evaluate(async () => {
		await Promise.all([
			document.fonts.ready,
			...[...document.images].map((img) => img.decode().catch(() => undefined)),
		]);
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
	});
}
