/**
 * Rendered-page fingerprint: geometry, font, and colours of every element of
 * each Maket render frame, measured in a live Chromium page. Two surfaces that
 * render a page identically produce equal fingerprints within a pixel.
 */

import type { RenderPage } from "../services/browser-pool.js";
import { RENDER_PAGE_TAG } from "./render-surface-html.js";

export interface RenderedElement {
	id: string;
	tag: string;
	box: [number, number, number, number];
	font: string;
	color: string;
	background: string;
}

export interface PageRenderDifference {
	differences: number;
	detail: string;
}

const BOX_TOLERANCE_PX = 1;

/** Measure every render frame of the page, in document order. */
export async function measureRenderFrames(
	page: RenderPage,
): Promise<RenderedElement[][]> {
	const frames = await page.evaluate((tag: string) => {
		const skipped = new Set(["STYLE", "SCRIPT", "TEMPLATE", "LINK", "META"]);
		return [...document.querySelectorAll(tag)].map((frame) => {
			const origin = frame.getBoundingClientRect();
			return [...frame.querySelectorAll("*")]
				.filter((el) => !skipped.has(el.tagName))
				.map((el) => {
					const rect = el.getBoundingClientRect();
					const style = getComputedStyle(el);
					return {
						id: el.getAttribute("data-id") ?? "",
						tag: el.tagName.toLowerCase(),
						box: [
							rect.left - origin.left,
							rect.top - origin.top,
							rect.width,
							rect.height,
						],
						font: `${style.fontFamily} ${style.fontSize} ${style.fontWeight}`,
						color: style.color,
						background: style.backgroundColor,
					};
				});
		});
	}, RENDER_PAGE_TAG);
	return Array.isArray(frames) ? (frames as RenderedElement[][]) : [];
}

function describeElement(el: RenderedElement): string {
	return el.id ? `${el.tag} data-id="${el.id}"` : el.tag;
}

function formatBox([x, y, w, h]: RenderedElement["box"]): string {
	return `${Math.round(w)}×${Math.round(h)} at ${Math.round(x)},${Math.round(y)}`;
}

function elementDifference(
	rendered: RenderedElement,
	preview: RenderedElement,
): string | null {
	if (
		rendered.box.some(
			(v, i) => Math.abs(v - (preview.box[i] ?? 0)) > BOX_TOLERANCE_PX,
		)
	)
		return `box ${formatBox(rendered.box)} instead of ${formatBox(preview.box)}`;
	if (rendered.font !== preview.font)
		return `font ${rendered.font} instead of ${preview.font}`;
	if (rendered.color !== preview.color)
		return `colour ${rendered.color} instead of ${preview.color}`;
	if (rendered.background !== preview.background)
		return `background ${rendered.background} instead of ${preview.background}`;
	return null;
}

/** Compare a page's export fingerprint with its preview fingerprint. */
export function comparePageRenders(
	rendered: RenderedElement[],
	preview: RenderedElement[],
): PageRenderDifference | null {
	if (rendered.length !== preview.length)
		return {
			differences: Math.abs(rendered.length - preview.length),
			detail: `${rendered.length} elements rendered instead of ${preview.length}`,
		};
	let differences = 0;
	let detail = "";
	rendered.forEach((el, i) => {
		const other = preview[i];
		const diff = other ? elementDifference(el, other) : "missing";
		if (!diff) return;
		differences += 1;
		if (!detail) detail = `first: ${describeElement(el)} ${diff}`;
	});
	return differences ? { differences, detail } : null;
}
