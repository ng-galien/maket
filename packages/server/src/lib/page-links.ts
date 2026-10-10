/**
 * Server side of in-document page links (`#page=3`, `#page:Name`; grammar in
 * `@maket/shared` page-links): layout-check issues and print/PDF rewriting.
 */

import {
	isTemplatedPageLink,
	type PageLinkTarget,
	parsePageLink,
	printPageAnchorId,
	resolvePageLink,
} from "@maket/shared";
import { parseHTML } from "linkedom";

export interface PageLinkIssue {
	href: string;
	/** `data-id` of the link or of its nearest addressable ancestor. */
	elementId: string | null;
	/** The target holds Mustache, which a page link does not accept. */
	templated: boolean;
}

interface LinkElement {
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	closest(selector: string): LinkElement | null;
}

function mayContainPageLink(html: string): boolean {
	return html.includes("#page");
}

function parseBody(html: string) {
	return parseHTML(`<html><body>${html}</body></html>`).document.body;
}

function linkElements(body: ReturnType<typeof parseBody>): LinkElement[] {
	return Array.from(
		body.querySelectorAll("a[href], area[href]"),
	) as unknown as LinkElement[];
}

function elementLabel(element: LinkElement): string {
	const id = element.closest("[data-id]")?.getAttribute("data-id");
	return id ? `data-id="${id}"` : "an element without data-id";
}

/** Write-time refusal of a page link whose target holds Mustache. */
export function templatedPageLinkError(html: string): string | null {
	if (!mayContainPageLink(html)) return null;
	const templated = linkElements(parseBody(html)).filter((element) =>
		isTemplatedPageLink(element.getAttribute("href")),
	);
	if (templated.length === 0) return null;
	return [
		"Page link targets are literals; Mustache is not accepted in a page link:",
		...templated.map(
			(element) =>
				`- \`${element.getAttribute("href")}\` on ${elementLabel(element)}`,
		),
		"Write #page=<n> (1-based number) or #page:<exact page name>.",
	].join("\n");
}

/** Page links in `html` that target no page of `pages`. */
export function brokenPageLinks(
	html: string,
	pages: readonly { name?: string }[],
): PageLinkIssue[] {
	if (!mayContainPageLink(html)) return [];
	const issues: PageLinkIssue[] = [];
	for (const element of linkElements(parseBody(html))) {
		const href = element.getAttribute("href") ?? "";
		const target = parsePageLink(href);
		if (!target || resolvePageLink(target, pages) !== null) continue;
		issues.push({
			href,
			elementId: element.closest("[data-id]")?.getAttribute("data-id") ?? null,
			templated: isTemplatedPageLink(href),
		});
	}
	return issues;
}

export function formatPageLinkIssues(
	issues: readonly PageLinkIssue[],
	pageCount: number,
): string {
	return [
		`⛔ page links: ${issues.length} link(s) target no page of this document (document has ${pageCount} page(s))`,
		...issues.map(
			(issue) =>
				`- \`${issue.href}\` on ${issue.elementId ? `data-id="${issue.elementId}"` : "an element without data-id"}${issue.templated ? " (Mustache is not accepted in a page link)" : ""}`,
		),
		"Use #page=<n> (1-based number) or #page:<exact page name>.",
	].join("\n");
}

function rewritePageLinks(
	html: string,
	anchorFor: (target: PageLinkTarget) => string | null,
): string {
	if (!mayContainPageLink(html)) return html;
	const body = parseBody(html);
	let changed = false;
	for (const element of linkElements(body)) {
		const target = parsePageLink(element.getAttribute("href"));
		if (!target) continue;
		const anchor = anchorFor(target);
		if (!anchor) continue;
		element.setAttribute("href", `#${anchor}`);
		changed = true;
	}
	return changed ? body.innerHTML : html;
}

/**
 * Rewrite page links of every printed page to the anchor of the first printed
 * page produced by the targeted source page. Rendered pages keep their source
 * id, or extend it as `<sourceId>:…` when a collection expands one template
 * page into several. A link whose target is not printed keeps its href, so the
 * printed geometry stays the preview geometry.
 */
export function linkPrintPages(
	sourcePages: readonly { id: string; name?: string }[],
	printedPageIds: readonly string[],
	pageHtmls: readonly string[],
): string[] {
	const printNumberFor = (sourceIndex: number): number | null => {
		const sourceId = sourcePages[sourceIndex]?.id;
		if (!sourceId) return null;
		const index = printedPageIds.findIndex(
			(id) => id === sourceId || id.startsWith(`${sourceId}:`),
		);
		return index >= 0 ? index + 1 : null;
	};
	return pageHtmls.map((html) =>
		rewritePageLinks(html, (target) => {
			const sourceIndex = resolvePageLink(target, sourcePages);
			const printNumber =
				sourceIndex === null ? null : printNumberFor(sourceIndex);
			return printNumber === null ? null : printPageAnchorId(printNumber);
		}),
	);
}
