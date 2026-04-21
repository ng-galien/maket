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

import { parseHTML } from "linkedom";

const FORBIDDEN_TAGS = new Set([
	"script",
	"iframe",
	"object",
	"embed",
	"frame",
	"frameset",
	"meta", // <meta http-equiv="refresh"> can navigate / fetch
	"base", // can rebase relative URLs to attacker.com
]);

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

/** Scrub every `on*` event-handler attribute and `javascript:` URL on a node. */
function scrubAttributes(el: any): void {
	if (!el || !el.attributes) return;
	const attrs = Array.from(el.attributes) as { name: string; value: string }[];
	for (const a of attrs) {
		const name = a.name.toLowerCase();
		if (name.startsWith("on")) {
			el.removeAttribute(a.name);
			continue;
		}
		if (URL_ATTRS.has(name)) {
			const v = (a.value ?? "").trim().toLowerCase();
			if (
				v.startsWith("javascript:") ||
				v.startsWith("vbscript:") ||
				v.startsWith("data:text/html")
			) {
				el.removeAttribute(a.name);
			}
		}
		// `srcdoc` on <iframe> is moot once we strip the iframe tag itself,
		// but cleanse defensively if it sneaks in elsewhere.
		if (name === "srcdoc") el.removeAttribute(a.name);
	}
}

export function stripActiveHtml(html: string): string {
	if (!html) return html;
	const { document: dom } = parseHTML(`<html><body>${html}</body></html>`);
	const body = dom.body;
	if (!body) return html;

	// Remove forbidden tags wholesale (depth-first; querySelectorAll returns
	// a snapshot so live mutation is safe).
	for (const tag of FORBIDDEN_TAGS) {
		const matches = body.querySelectorAll(tag);
		for (const node of Array.from(matches)) node.remove();
	}

	// Walk every remaining element and scrub event handlers + dangerous URLs.
	const all = body.querySelectorAll("*");
	for (const el of Array.from(all)) scrubAttributes(el);

	return body.innerHTML;
}
