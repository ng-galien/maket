/**
 * Remove executable / network-active constructs from agent-authored HTML
 * before persisting it. Maket renders the resulting HTML in:
 *
 *   - the live preview iframe (browser, same origin as the UI)
 *   - puppeteer for PDF / thumbnail / snapshot exports
 *   - inline screenshots returned to the agent in tool results
 *
 * In all three contexts, an active element (`<script>`, `<iframe>`, an
 * `onerror=` handler) is a vector — either an XSS into the Maket UI or, in
 * the snapshot path, a way to render fetched content into the PNG that
 * comes back to the agent (data exfiltration).
 *
 * The set we strip is intentionally conservative — it eliminates the
 * obvious exfiltration / execution channels without trying to be a full
 * sanitizer. Charte CSS, layout, images, links, and headings are untouched.
 *
 * Returns the cleaned HTML string. Pure function — no side effects.
 *
 * **Invariant:** every code path that assigns to `page.html` MUST call
 * this helper. Today's call sites (keep this list in sync if you add
 * another write):
 *   - `tools/html.ts`             (maket_html set / patch)
 *   - `tools/pages.ts`            (maket_page add)
 *   - `tools/mermaid.ts`          (diagram injection)
 *   - `services/ws-handler.ts`    (text_edit WS message)
 *   - `routes/export.routes.ts`   (.maket bundle import)
 */

import { stripActiveIn } from "@maket/shared";
import { parseHTML } from "linkedom";

export function stripActiveHtml(html: string): string {
	if (!html) return html;
	const { document: dom } = parseHTML(`<html><body>${html}</body></html>`);
	const body = dom.body;
	if (!body) return html;
	stripActiveIn(body);
	return body.innerHTML;
}

/** Remove Maket's live document-navigation hooks from rendered HTML that is
 * leaving its owning workspace as a static portable snapshot. */
export function stripDocumentNavigationHtml(html: string): string {
	if (!html) return html;
	const body = parseBody(html);
	if (!body) return html;
	stripDocumentNavigationIn(body);
	return body.innerHTML;
}

function parseBody(html: string): HTMLElement | null {
	return parseHTML(`<html><body>${html}</body></html>`).document.body;
}

function stripDocumentNavigationIn(body: HTMLElement): void {
	for (const element of navigationElements(body)) {
		stripDocumentNavigationElement(element);
	}
}

function navigationElements(body: HTMLElement): NodeListOf<HTMLElement> {
	return body.querySelectorAll<HTMLElement>(
		'[data-maket-action="open-document"], [data-maket-document]',
	);
}

function stripDocumentNavigationElement(element: HTMLElement): void {
	stripNavigationAttributes(element);
	stripButtonRole(element);
	stripKeyboardAffordance(element);
	stripPointerAffordance(element);
	neutralizeNativeNavigationControl(element);
}

function stripNavigationAttributes(element: HTMLElement): void {
	element.removeAttribute("data-maket-action");
	element.removeAttribute("data-maket-document");
}

function stripButtonRole(element: HTMLElement): void {
	if (element.getAttribute("role") === "button")
		element.removeAttribute("role");
}

function stripKeyboardAffordance(element: HTMLElement): void {
	if (element.getAttribute("tabindex") === "0") {
		element.removeAttribute("tabindex");
	}
}

function stripPointerAffordance(element: HTMLElement): void {
	element.style.removeProperty("cursor");
	if (!element.getAttribute("style")) element.removeAttribute("style");
}

function neutralizeNativeNavigationControl(element: HTMLElement): void {
	if (!isNativeNavigationControl(element)) return;
	const replacement = createNeutralElement(element);
	copyPresentationAttributes(element, replacement);
	moveChildren(element, replacement);
	element.replaceWith(replacement);
}

function isNativeNavigationControl(element: HTMLElement): boolean {
	return element.tagName === "BUTTON" || element.tagName === "A";
}

function createNeutralElement(element: HTMLElement): HTMLElement {
	return element.ownerDocument.createElement("span");
}

function copyPresentationAttributes(
	source: HTMLElement,
	target: HTMLElement,
): void {
	for (const attribute of Array.from(source.attributes)) {
		if (isInteractiveAttribute(attribute.name)) continue;
		target.setAttribute(attribute.name, attribute.value);
	}
}

function isInteractiveAttribute(name: string): boolean {
	const normalized = name.toLowerCase();
	return (
		normalized.startsWith("on") ||
		normalized === "href" ||
		normalized === "target" ||
		normalized === "download" ||
		normalized === "ping" ||
		normalized === "referrerpolicy" ||
		normalized === "type" ||
		normalized === "name" ||
		normalized === "value" ||
		normalized === "disabled" ||
		normalized === "autofocus" ||
		normalized === "form" ||
		normalized.startsWith("form") ||
		normalized === "role" ||
		normalized === "tabindex"
	);
}

function moveChildren(source: HTMLElement, target: HTMLElement): void {
	while (source.firstChild) target.appendChild(source.firstChild);
}
