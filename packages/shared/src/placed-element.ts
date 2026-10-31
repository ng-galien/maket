/**
 * Placed elements: top-level page elements positioned absolutely in
 * millimetres through their inline style. The canvas palette writes them,
 * the person moves and resizes them, and the agent edits them as ordinary
 * HTML. Server and browser share this style reading so both sides agree on
 * which element is placed and where it sits.
 */

export const PLACED_ELEMENT_KINDS = ["text", "image", "frame"] as const;
export type PlacedElementKind = (typeof PLACED_ELEMENT_KINDS)[number];

/** Position and size in millimetres from the page's top-left corner. */
export interface PlacedBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

const BOX_PROPERTIES = ["left", "top", "width", "height"] as const;
const MM_VALUE = /^(-?\d+(?:\.\d+)?)mm$/;

/** `data-id` of the canonical page root that layout measurement reads. */
export const PAGE_ROOT_ID = "page";

/** HTML of a blank page composed by hand: the canonical page root filling
 * the page, positioned so placed elements are laid out against it. */
export const BLANK_PAGE_HTML = `<div data-id="${PAGE_ROOT_ID}" style="position:relative;width:100%;height:100%;margin:0;padding:0"></div>`;

interface ContainerNode {
	readonly children: ArrayLike<unknown>;
	getAttribute(name: string): string | null;
}

const ZERO_LENGTH = /^0(?:mm|px|cm|in|pt)?$/;
const OFFSET_PROPERTIES = [
	"margin",
	"margin-top",
	"margin-left",
	"border",
	"border-width",
	"border-top",
	"border-left",
	"top",
	"left",
	"inset",
];

/** True when a root with this inline style keeps the page's top-left corner
 * as the origin of its absolutely positioned children: either it is not
 * positioned (children are laid out against the page itself), or it is the
 * page-covering `position:relative` root with no offset, margin or border. */
function anchorsAtPageOrigin(style: string | null): boolean {
	const declarations = new Map(parseInlineStyle(style ?? ""));
	if (declarations.has("transform") || declarations.has("translate"))
		return false;
	const position = declarations.get("position");
	if (!position || position === "static") return true;
	if (position !== "relative") return false;
	if (declarations.get("width") !== "100%") return false;
	if (declarations.get("height") !== "100%") return false;
	return OFFSET_PROPERTIES.every((name) => {
		const value = declarations.get(name);
		return value === undefined || ZERO_LENGTH.test(value);
	});
}

/** The element placed elements belong to, inside the page content. It is
 * the page root that layout measurement reads (the `data-id="page"` block,
 * else the single top-level block that is not itself placed) when that root
 * keeps the page origin (see `anchorsAtPageOrigin`); otherwise the page
 * content itself, so millimetre offsets always count from the page corner.
 * Server and browser apply the same rule to their own DOM. */
export function placedContainer<T extends ContainerNode>(content: T): T {
	const children = Array.from(content.children) as T[];
	const blocks = children.filter((child) => child.getAttribute("data-id"));
	const canonical = blocks.find(
		(child) => child.getAttribute("data-id") === PAGE_ROOT_ID,
	);
	const [only] = blocks;
	const root =
		canonical ??
		(blocks.length === 1 &&
		only &&
		!placedBoxFromStyle(only.getAttribute("style"))
			? only
			: null);
	return root && anchorsAtPageOrigin(root.getAttribute("style"))
		? root
		: content;
}

/** Formats a page can be composed by hand on: every fixed format. */
export function placedCompositionFormat(format: string): boolean {
	return format !== "AUTO";
}

/** Inline style declarations in source order, property names lower-cased. */
export function parseInlineStyle(style: string): Array<[string, string]> {
	const declarations: Array<[string, string]> = [];
	for (const part of style.split(";")) {
		const colon = part.indexOf(":");
		if (colon < 0) continue;
		const name = part.slice(0, colon).trim().toLowerCase();
		const value = part.slice(colon + 1).trim();
		if (name) declarations.push([name, value]);
	}
	return declarations;
}

export function serializeInlineStyle(
	declarations: Array<[string, string]>,
): string {
	return declarations.map(([name, value]) => `${name}:${value}`).join(";");
}

/** The millimetre box of an inline style with `position:absolute` and
 * left, top, width and height in mm; null for any other style. */
export function placedBoxFromStyle(style: string | null): PlacedBox | null {
	if (!style) return null;
	const map = new Map(parseInlineStyle(style));
	if (map.get("position") !== "absolute") return null;
	const values: number[] = [];
	for (const property of BOX_PROPERTIES) {
		const match = MM_VALUE.exec(map.get(property) ?? "");
		if (!match) return null;
		values.push(Number(match[1]));
	}
	const [left, top, width, height] = values as [number, number, number, number];
	return { left, top, width, height };
}

/** Rounds to a tenth of a millimetre. */
export function roundMm(value: number): number {
	return Math.round(value * 10) / 10;
}

function mm(value: number): string {
	return `${roundMm(value)}mm`;
}

/** Replaces left, top, width and height in an inline style, keeping every
 * other declaration in place. */
export function styleWithPlacedBox(style: string, box: PlacedBox): string {
	const declarations = parseInlineStyle(style);
	const pending = new Map<string, string>([
		["left", mm(box.left)],
		["top", mm(box.top)],
		["width", mm(box.width)],
		["height", mm(box.height)],
	]);
	const next = declarations.map(([name, value]): [string, string] => {
		const replacement = pending.get(name);
		if (replacement === undefined) return [name, value];
		pending.delete(name);
		return [name, replacement];
	});
	for (const [name, value] of pending) next.push([name, value]);
	return serializeInlineStyle(next);
}

/** Smallest width and height, in millimetres, a placed element keeps. */
export const PLACED_MIN_SIZE_MM = 2;

/** Keeps a box inside a page of `pageWidth` × `pageHeight` millimetres,
 * with at least the minimum size, rounded to a tenth of a millimetre. */
export function clampPlacedBox(
	box: PlacedBox,
	pageWidth: number,
	pageHeight: number,
): PlacedBox {
	const width = Math.min(Math.max(box.width, PLACED_MIN_SIZE_MM), pageWidth);
	const height = Math.min(Math.max(box.height, PLACED_MIN_SIZE_MM), pageHeight);
	const left = Math.min(Math.max(box.left, 0), pageWidth - width);
	const top = Math.min(Math.max(box.top, 0), pageHeight - height);
	return {
		left: roundMm(left),
		top: roundMm(top),
		width: roundMm(width),
		height: roundMm(height),
	};
}

/** True when every number is finite, the size positive, and the box inside
 * the page within a twentieth of a millimetre. */
export function placedBoxFits(
	box: PlacedBox,
	pageWidth: number,
	pageHeight: number,
): boolean {
	const values = [box.left, box.top, box.width, box.height];
	if (!values.every((value) => Number.isFinite(value))) return false;
	if (box.width <= 0 || box.height <= 0) return false;
	const tolerance = 0.05;
	return (
		box.left >= -tolerance &&
		box.top >= -tolerance &&
		box.left + box.width <= pageWidth + tolerance &&
		box.top + box.height <= pageHeight + tolerance
	);
}
