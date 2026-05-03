// ============================================================
// CHARTE CSS — Generate CSS variables from design tokens
// ============================================================

import type { Charte } from "../types.js";

/** Quote font names with spaces for CSS font-family */
function quoteFontValue(group: string, value: string): string {
	if (
		group !== "font" ||
		!value.includes(" ") ||
		value.startsWith("'") ||
		value.startsWith('"')
	)
		return value;
	return `'${value}'`;
}

/** Flatten charte tokens to a list of [varName, cssValue] pairs */
function flattenTokens(charte: Charte): [string, string][] {
	const entries: [string, string][] = [];
	if (!charte.tokens) return entries;
	for (const [group, values] of Object.entries(charte.tokens)) {
		if (!values || typeof values !== "object") continue;
		for (const [key, value] of Object.entries(values)) {
			entries.push([`--charte-${group}-${key}`, quoteFontValue(group, value)]);
		}
	}
	return entries;
}

/** Generate :root { } CSS string from charte tokens */
export function charteToCSS(charte: Charte): string {
	const entries = flattenTokens(charte);
	if (entries.length === 0) return "";
	return `:root {\n${entries.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
}

// Google Fonts family names are alphanumerics, spaces, and hyphens (e.g.
// "Source Sans 3", "JetBrains Mono"). Anything else — `&`, `=`, `?`, `,` —
// is either invalid for the Fonts API or dangerous when spliced into the
// query string (it would let a malicious charte token inject extra params).
// Reject conservatively rather than encoding.
const VALID_FAMILY_NAME = /^[A-Za-z0-9 -]+$/;

/** Generate Google Fonts @import from charte font tokens */
export function charteFontImport(charte: Charte): string {
	const fonts = charte.tokens?.font;
	if (!fonts) return "";

	const GENERIC = new Set([
		"serif",
		"sans-serif",
		"monospace",
		"system-ui",
		"cursive",
		"fantasy",
		"inherit",
	]);
	const families = new Set<string>();

	for (const value of Object.values(fonts)) {
		const [first = ""] = value.split(",");
		const name = first.replace(/['"]/g, "").trim();
		if (!name || GENERIC.has(name.toLowerCase())) continue;
		if (!VALID_FAMILY_NAME.test(name)) continue;
		families.add(name);
	}

	if (families.size === 0) return "";
	const params = [...families].map(
		(f) =>
			`family=${f.replace(/ /g, "+")}:ital,wght@0,300;0,400;0,600;0,700;1,400`,
	);
	return `@import url('https://fonts.googleapis.com/css2?${params.join("&")}&display=swap');`;
}

/** Combined CSS the `charte:updated` broadcast ships to clients — font
 * import + var block. `ensureCharteFonts()` on the client scans this for
 * `@import url(...)` to live-load new Google Fonts, so font-token edits
 * propagate to already-open docs without a full reload. */
export function composeCharteCss(charte: Charte): string {
	const fontImport = charteFontImport(charte);
	const vars = charteToCSS(charte);
	return fontImport ? `${fontImport}\n${vars}` : vars;
}

/** Parse CSS var definitions from a :root {} block. Returns Map<varName, value> */
export function parseCharteVars(css: string): Map<string, string> {
	const vars = new Map<string, string>();
	for (const match of css.matchAll(/(--charte-[^:]+):\s*([^;]+)/g)) {
		const [, key = "", val = ""] = match;
		if (key) vars.set(key.trim(), val.trim());
	}
	return vars;
}
