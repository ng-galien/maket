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
