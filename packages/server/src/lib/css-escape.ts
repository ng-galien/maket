/**
 * Defensive escapes for user-controlled CSS that lands inside a `<style>`
 * element rendered by puppeteer or the browser preview.
 *
 * These helpers exist because charte token values, `canvas.bg`, and other
 * MCP/WS-settable strings get injected verbatim into rendered HTML. Without
 * escaping, a value like `red} body{background:url(http://evil)}` opens a
 * second rule, and a value containing `</style>` closes the block entirely
 * and lets HTML tokens through.
 *
 * Both functions are pure — same input, same output, no side effects. They
 * are called from `thumbnail.ts`, `pdf.ts`, and `layout.ts` (anywhere CSS
 * gets concatenated into a `<style>` block).
 */

/**
 * Escape a single CSS property value (e.g. a colour, a font family). Only
 * the characters that can break out of the declaration are touched: `;}{<>"'\`.
 * Everything else (digits, letters, hex codes, `#`) is preserved.
 */
export function escapeCssValue(v: string): string {
	return v.replace(
		/[;}{<>"'\\]/g,
		(c) => `\\${c.codePointAt(0)?.toString(16)} `,
	);
}

/**
 * Neutralise any `</style` sequence in a CSS blob. HTML rawtext tokenisation
 * closes the surrounding `<style>` element at the first literal match — a
 * malicious value would otherwise smuggle markup past the CSS context. We
 * rewrite `/` as its CSS escape `\2f ` so CSS still parses (as a garbage
 * token, which is acceptable) but the HTML tokeniser no longer sees a close.
 */
export function stripStyleClose(css: string): string {
	return css.replace(/<\/style/gi, "<\\2f style");
}
