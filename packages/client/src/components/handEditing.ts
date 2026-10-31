import {
	clampPlacedBox,
	type PlacedBox,
	type PlacedElementKind,
	placedBoxFromStyle,
	placedContainer,
	roundMm,
} from "@maket/shared";

/** Handles of the selection frame: corners and edge midpoints. */
export const RESIZE_HANDLES = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w",
] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** The placed element under `target`: a child of the page root (see
 * `placedContainer`) with a `data-id` and an inline absolute box in mm. */
export function placedElementAt(
	contentRoot: HTMLElement,
	target: EventTarget | null,
): HTMLElement | null {
	if (!(target instanceof Element)) return null;
	const container = placedContainer(contentRoot);
	let element: Element | null = target.closest("[data-id]");
	while (element && element.parentElement !== container) {
		element = element.parentElement?.closest("[data-id]") ?? null;
	}
	if (!(element instanceof HTMLElement) || !contentRoot.contains(element))
		return null;
	return placedBoxFromStyle(element.getAttribute("style")) ? element : null;
}

export function placedBoxOf(element: HTMLElement): PlacedBox | null {
	return placedBoxFromStyle(element.getAttribute("style"));
}

/** Millimetres covered by one screen pixel on a page of `pageWidthMm`
 * rendered `renderedWidthPx` wide, whatever the board zoom. */
export function millimetresPerPixel(
	pageWidthMm: number,
	renderedWidthPx: number,
): number {
	return renderedWidthPx > 0 ? pageWidthMm / renderedWidthPx : 0;
}

/** The box after dragging the whole element by (`dx`, `dy`) millimetres,
 * kept inside the page. */
export function movedBox(
	box: PlacedBox,
	dx: number,
	dy: number,
	page: { w: number; h: number },
): PlacedBox {
	return clampPlacedBox(
		{ ...box, left: box.left + dx, top: box.top + dy },
		page.w,
		page.h,
	);
}

/** The box after dragging `handle` by (`dx`, `dy`) millimetres: the
 * opposite edges stay in place, and the box stays inside the page. */
export function resizedBox(
	box: PlacedBox,
	handle: ResizeHandle,
	dx: number,
	dy: number,
	page: { w: number; h: number },
): PlacedBox {
	let { left, top } = box;
	let right = box.left + box.width;
	let bottom = box.top + box.height;
	if (handle.includes("w")) left = Math.min(left + dx, right - 2);
	if (handle.includes("e")) right = Math.max(right + dx, left + 2);
	if (handle.includes("n")) top = Math.min(top + dy, bottom - 2);
	if (handle.includes("s")) bottom = Math.max(bottom + dy, top + 2);
	left = Math.max(left, 0);
	top = Math.max(top, 0);
	right = Math.min(right, page.w);
	bottom = Math.min(bottom, page.h);
	return {
		left: roundMm(left),
		top: roundMm(top),
		width: roundMm(right - left),
		height: roundMm(bottom - top),
	};
}

const DEFAULT_SIZE: Record<
	PlacedElementKind,
	{ width: number; height: number }
> = {
	text: { width: 80, height: 15 },
	image: { width: 60, height: 40 },
	frame: { width: 60, height: 40 },
};

/** Where a new element lands: centred on the page, inside it. */
export function defaultPlacedBox(
	kind: PlacedElementKind,
	page: { w: number; h: number },
): PlacedBox {
	const size = DEFAULT_SIZE[kind];
	const width = Math.min(size.width, page.w);
	const height = Math.min(size.height, page.h);
	return clampPlacedBox(
		{
			left: (page.w - width) / 2,
			top: (page.h - height) / 2,
			width,
			height,
		},
		page.w,
		page.h,
	);
}

/** Shows `box` on the element while a gesture runs; the server's next state
 * replaces it with the persisted value. */
export function applyPlacedBox(element: HTMLElement, box: PlacedBox): void {
	element.style.left = `${box.left}mm`;
	element.style.top = `${box.top}mm`;
	element.style.width = `${box.width}mm`;
	element.style.height = `${box.height}mm`;
}
