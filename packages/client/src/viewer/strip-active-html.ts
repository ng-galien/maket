/**
 * Browser port of the server's `strip-active-html.ts` — same forbidden-tag
 * and attribute-scrubbing semantics, backed by the native DOMParser (which
 * produces an inert document: nothing executes during parsing).
 *
 * The server enforces the invariant "every code path that assigns to
 * `page.html` must strip active content". The viewer hydrates `page.html`
 * from untrusted `.maket` files, so it is such a code path.
 */

const FORBIDDEN_TAGS = [
	"script",
	"iframe",
	"object",
	"embed",
	"frame",
	"frameset",
	"meta",
	"base",
];

const URL_ATTRS = new Set([
	"href",
	"src",
	"action",
	"formaction",
	"poster",
	"background",
	"cite",
	"data",
	"usemap",
]);

function scrubAttributes(el: Element): void {
	for (const attr of [...el.attributes]) {
		const name = attr.name.toLowerCase();
		if (name.startsWith("on")) {
			el.removeAttribute(attr.name);
			continue;
		}
		if (URL_ATTRS.has(name)) {
			const value = (attr.value ?? "").trim().toLowerCase();
			if (
				value.startsWith("javascript:") ||
				value.startsWith("vbscript:") ||
				value.startsWith("data:text/html")
			) {
				el.removeAttribute(attr.name);
			}
		}
		if (name === "srcdoc") el.removeAttribute(attr.name);
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

	for (const tag of FORBIDDEN_TAGS) {
		for (const node of [...body.querySelectorAll(tag)]) node.remove();
	}
	for (const el of [...body.querySelectorAll("*")]) scrubAttributes(el);

	return body.innerHTML;
}
