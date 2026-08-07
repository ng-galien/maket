/**
 * Security policy for agent-authored / untrusted document HTML — the single
 * source of truth for which constructs are stripped before rendering.
 *
 * Two enforcement sites share this policy with different DOM backends:
 *   - server `lib/strip-active-html.ts` (linkedom) — every `page.html` write
 *   - viewer  `viewer/strip-active-html.ts` (DOMParser) — untrusted `.maket`
 *
 * Hardening the policy here reaches both sides at once. Keep the sets
 * conservative: eliminate execution/exfiltration channels without becoming
 * a full sanitizer (charte CSS, layout, images, links stay untouched).
 */

export const FORBIDDEN_ACTIVE_TAGS: readonly string[] = [
	"script",
	"iframe",
	"object",
	"embed",
	"frame",
	"frameset",
	"meta", // <meta http-equiv="refresh"> can navigate / fetch
	"base", // can rebase relative URLs to attacker.com
];

export const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
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

export function isForbiddenUrlValue(value: string): boolean {
	const v = value.trim().toLowerCase();
	return (
		v.startsWith("javascript:") ||
		v.startsWith("vbscript:") ||
		v.startsWith("data:text/html")
	);
}

/** Minimal structural DOM surface both linkedom and the browser satisfy. */
export interface ScrubbableElement {
	attributes: ArrayLike<{ name: string; value: string }>;
	removeAttribute(name: string): void;
}

export interface ScrubbableRoot {
	querySelectorAll(selector: string): ArrayLike<{ remove(): void }>;
}

/** Scrub every `on*` handler, forbidden URL scheme and `srcdoc` on a node. */
export function scrubActiveAttributes(el: ScrubbableElement): void {
	if (!el?.attributes) return;
	for (const a of Array.from(el.attributes)) {
		const name = a.name.toLowerCase();
		if (name.startsWith("on")) {
			el.removeAttribute(a.name);
			continue;
		}
		if (URL_ATTRIBUTES.has(name) && isForbiddenUrlValue(a.value ?? "")) {
			el.removeAttribute(a.name);
		}
		if (name === "srcdoc") el.removeAttribute(a.name);
	}
}

/** Remove forbidden tags and scrub all remaining elements under `body`. */
export function stripActiveIn(body: ScrubbableRoot): void {
	for (const tag of FORBIDDEN_ACTIVE_TAGS) {
		for (const node of Array.from(body.querySelectorAll(tag))) node.remove();
	}
	for (const el of Array.from(body.querySelectorAll("*"))) {
		scrubActiveAttributes(el as unknown as ScrubbableElement);
	}
}
