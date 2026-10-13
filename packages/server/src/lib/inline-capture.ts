/**
 * Inline images drawn by Chromium: a render surface is loaded in a page at
 * the document's pixel size, then the inline image is a screenshot of a
 * region with clip and scale. Charte CSS, variables and color-mix resolve
 * exactly as in the document, and no full-size image is decoded in
 * JavaScript, so the event loop stays free.
 */

import type { BrowserPool, RenderPage } from "../services/browser-pool.js";
import type { Document } from "../types.js";
import { measureAutoPageHeights } from "./auto-page-height.js";
import {
	fitsInline,
	type InlineFrame,
	inlineFrame,
	inlineScales,
} from "./bounded-image.js";
import { installNetworkGuard } from "./page-network-guard.js";
import { waitForPageStable } from "./page-stable-wait.js";

/** Pixels per millimetre of the render surface. */
export const SURFACE_PX_PER_MM = 3.78;

/** Load a render surface offline and size the viewport to its page; an
 * AUTO page takes its measured height. Answers the viewport. */
export async function loadSurface(
	page: RenderPage,
	canvas: Document["canvas"],
	html: string,
): Promise<{ width: number; height: number }> {
	await installNetworkGuard(page, "offline");
	const viewport = {
		width: Math.ceil(canvas.w * SURFACE_PX_PER_MM),
		height:
			canvas.format === "AUTO" ? 900 : Math.ceil(canvas.h * SURFACE_PX_PER_MM),
	};
	await page.setViewport(viewport);
	await page.setContent(html, { waitUntil: "load" });
	await waitForPageStable(page);
	if (canvas.format === "AUTO") {
		const [height] = await measureAutoPageHeights(page);
		viewport.height = height ?? 1;
		await page.setViewport(viewport);
	}
	return viewport;
}

export interface InlineCapture {
	data: Buffer;
	mimeType: "image/png" | "image/jpeg";
	width: number;
	height: number;
}

/** The frame's region, moved by `origin`, as Chromium draws it: PNG at the
 * frame's scale, then JPEG at falling scales until it fits inline. */
export async function captureInline(
	page: RenderPage,
	frame: InlineFrame,
	origin: { x: number; y: number } = { x: 0, y: 0 },
): Promise<InlineCapture> {
	for (const [index, scale] of inlineScales(frame).entries()) {
		const type = index === 0 ? "png" : "jpeg";
		const data = Buffer.from(
			(await page.screenshot({
				type,
				...(type === "jpeg" ? { quality: 80 } : {}),
				clip: {
					...frame.region,
					x: frame.region.x + origin.x,
					y: frame.region.y + origin.y,
					scale,
				},
			})) as Buffer,
		);
		if (fitsInline(data))
			return {
				data,
				mimeType: type === "png" ? "image/png" : "image/jpeg",
				width: Math.max(1, Math.round(frame.region.width * scale)),
				height: Math.max(1, Math.round(frame.region.height * scale)),
			};
	}
	throw new Error("The inline image does not fit the inline bound.");
}

/** The element bearing `dataId` on a render surface, drawn by Chromium:
 * its frame (the top or left part beyond a 2:1 ratio) at up to `maxScale`
 * pixels per surface pixel. Null when the element is absent or empty. */
export async function captureSurfaceElement(
	browserPool: Pick<BrowserPool, "get">,
	surface: { canvas: Document["canvas"]; html: string },
	target: { dataId: string; maxScale: number },
): Promise<{ capture: InlineCapture; frame: InlineFrame } | null> {
	const browser = await browserPool.get();
	const page = await browser.newPage();
	try {
		await loadSurface(page, surface.canvas, surface.html);
		const box = (await page.evaluate(
			`(() => { const element = document.querySelector('[data-id=' + ${JSON.stringify(JSON.stringify(target.dataId))} + ']'); if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height }; })()`,
		)) as { x: number; y: number; width: number; height: number } | null;
		if (!box || box.width < 1 || box.height < 1) return null;
		const frame = inlineFrame(box.width, box.height, target.maxScale);
		return {
			capture: await captureInline(page, frame, { x: box.x, y: box.y }),
			frame,
		};
	} finally {
		await page.close();
	}
}
