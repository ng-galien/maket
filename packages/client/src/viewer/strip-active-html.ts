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

export function stripActiveHtml(html: string): string {
	if (!html) return html;
	const doc = new DOMParser().parseFromString(
		`<html><body>${html}</body></html>`,
		"text/html",
	);
	const body = doc.body;
	if (!body) return html;
	stripActiveIn(body);
	return body.innerHTML;
}
