/**
 * Browser port of the server's `strip-active-html.ts` — same forbidden-tag
 * and attribute-scrubbing semantics, backed by the native DOMParser (which
 * produces an inert document: nothing executes during parsing).
 *
 * The server enforces the invariant "every code path that assigns to
 * `page.html` must strip active content". The viewer hydrates `page.html`
 * from untrusted `.maket` files, so it is such a code path.
 */

import { stripActiveIn } from "@maket/shared";

const PASSIVE_FETCH_ATTRIBUTES = new Set(["background", "poster", "src"]);

function isOfflineResource(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		normalized.startsWith("#") ||
		normalized.startsWith("blob:") ||
		normalized.startsWith("data:image/") ||
		normalized.startsWith("data:audio/") ||
		normalized.startsWith("data:video/")
	);
}

/**
 * Remove CSS fetches while preserving the declaration itself. Bundle assets
 * have already been rewritten to blob: URLs before this runs.
 */
export function stripNetworkCss(css: string): string {
	return css
		.replace(/@import\s+(?:url\()?["']?[^;)"']+["']?\)?\s*;?/gi, "")
		.replace(
			/url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
			(match, _quote: string, value: string) =>
				isOfflineResource(value) ? match : 'url("")',
		);
}

function stripPassiveNetworkLoads(body: HTMLElement): void {
	for (const link of Array.from(body.querySelectorAll("link"))) link.remove();
	for (const style of Array.from(body.querySelectorAll("style"))) {
		style.textContent = stripNetworkCss(style.textContent ?? "");
	}
	for (const element of Array.from(body.querySelectorAll("*"))) {
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			if (name === "srcset") {
				element.removeAttribute(attribute.name);
				continue;
			}
			if (
				PASSIVE_FETCH_ATTRIBUTES.has(name) ||
				name === "xlink:href" ||
				(name === "href" &&
					element.namespaceURI === "http://www.w3.org/2000/svg")
			) {
				if (!isOfflineResource(attribute.value)) {
					element.removeAttribute(attribute.name);
				}
			}
			if (name === "style") {
				element.setAttribute("style", stripNetworkCss(attribute.value));
			}
		}
	}
}

export function stripActiveHtml(html: string): string {
	if (!html) return html;
	const doc = new DOMParser().parseFromString(
		`<html><body>${html}</body></html>`,
		"text/html",
	);
	const body = doc.body;
	if (!body) return html;
	stripActiveIn(body);
	stripPassiveNetworkLoads(body);
	return body.innerHTML;
}
