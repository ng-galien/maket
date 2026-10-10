/**
 * Links between pages of one document, authored as plain fragment hrefs.
 *
 *   - `#page=3`       canonical form: 1-based page number in the document.
 *   - `#page:Summary` exact page name, kept when pages are reordered.
 *
 * Canvas, Reader, and the standalone viewer navigate inside the document;
 * print and PDF rewrite the href to the anchor of the printed page.
 */

export type PageLinkTarget =
	| { kind: "number"; number: number }
	| { kind: "name"; name: string };

const NUMBER_PREFIX = "#page=";
const NAME_PREFIX = "#page:";
const PRINT_ANCHOR_PREFIX = "maket-page-";

function decodeFragment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** A page-link href holding a Mustache expression. Page-link targets are
 * literals: writes refuse it and such a link targets no page. */
export function isTemplatedPageLink(href: string | null | undefined): boolean {
	const value = href?.trim() ?? "";
	return (
		(value.startsWith(NUMBER_PREFIX) || value.startsWith(NAME_PREFIX)) &&
		value.includes("{{")
	);
}

/** Parse a page-link href; null when the href is not a page link. */
export function parsePageLink(
	href: string | null | undefined,
): PageLinkTarget | null {
	if (!href) return null;
	const value = href.trim();
	if (isTemplatedPageLink(value)) return { kind: "number", number: Number.NaN };
	if (value.startsWith(NUMBER_PREFIX)) {
		const raw = value.slice(NUMBER_PREFIX.length).trim();
		return {
			kind: "number",
			number: /^\d+$/.test(raw) ? Number(raw) : Number.NaN,
		};
	}
	if (value.startsWith(NAME_PREFIX)) {
		return {
			kind: "name",
			name: decodeFragment(value.slice(NAME_PREFIX.length)).trim(),
		};
	}
	return null;
}

/** 0-based index of the targeted page, or null when the document has no
 * such page. A name resolves to the first page carrying it. */
export function resolvePageLink(
	target: PageLinkTarget,
	pages: readonly { name?: string }[],
): number | null {
	if (target.kind === "number") {
		return Number.isInteger(target.number) &&
			target.number >= 1 &&
			target.number <= pages.length
			? target.number - 1
			: null;
	}
	if (!target.name) return null;
	const index = pages.findIndex((page) => page.name === target.name);
	return index >= 0 ? index : null;
}

/** Element id carried by the n-th (1-based) page of a print surface. */
export function printPageAnchorId(printPageNumber: number): string {
	return `${PRINT_ANCHOR_PREFIX}${printPageNumber}`;
}
