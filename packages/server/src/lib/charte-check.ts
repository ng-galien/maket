// ============================================================
// CHARTE COMPLIANCE — Validate HTML against charte design tokens
// ============================================================

import { parseHTML } from "linkedom";
import type { Charte } from "../types.js";

export interface CharteViolation {
	elementId: string;
	property: string;
	value: string;
	suggestion: string;
}

/** Normalize a CSS color to lowercase #rrggbb, or null if unrecognized */
function normalizeColor(raw: string): string | null {
	const v = raw.trim().toLowerCase();

	// #rgb → #rrggbb
	if (/^#[0-9a-f]{3}$/.test(v)) {
		return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
	}
	// #rrggbb or #rrggbbaa → #rrggbb
	if (/^#[0-9a-f]{6,8}$/.test(v)) {
		return v.slice(0, 7);
	}
	// rgb(r, g, b) or rgba(r, g, b, a)
	const rgbMatch = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgbMatch) {
		const [, r = "0", g = "0", b = "0"] = rgbMatch;
		const hex = (n: string) =>
			Number.parseInt(n, 10).toString(16).padStart(2, "0");
		return `#${hex(r)}${hex(g)}${hex(b)}`;
	}
	return null;
}

/** Build inverted color map: normalized hex → CSS var name */
function buildColorMap(charte: Charte): Map<string, string> {
	const map = new Map<string, string>();
	const colors = charte.tokens?.color;
	if (!colors) return map;
	for (const [key, value] of Object.entries(colors)) {
		const norm = normalizeColor(value);
		if (norm) map.set(norm, `var(--charte-color-${key})`);
	}
	return map;
}

/** Parse inline style string into property → value map */
export function parseStyle(style: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const part of style.split(";")) {
		const colon = part.indexOf(":");
		if (colon < 0) continue;
		const prop = part.slice(0, colon).trim().toLowerCase();
		const val = part.slice(colon + 1).trim();
		if (prop && val) map.set(prop, val);
	}
	return map;
}

const COLOR_PROPERTIES = new Set([
	"color",
	"background-color",
	"border-color",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"outline-color",
]);

/** Check color properties against the inverted map */
function checkColors(
	styleMap: Map<string, string>,
	colorMap: Map<string, string>,
	elementId: string,
): CharteViolation[] {
	if (colorMap.size === 0) return [];
	const violations: CharteViolation[] = [];

	for (const [prop, value] of styleMap) {
		// Skip values already using var()
		if (value.includes("var(--charte-")) continue;

		let propsToCheck: string[] = [];
		if (COLOR_PROPERTIES.has(prop)) {
			propsToCheck = [prop];
		} else if (prop === "background") {
			// background shorthand — only check if it looks like a plain color (not gradient/url)
			if (value.includes("gradient") || value.includes("url(")) continue;
			propsToCheck = ["background"];
		} else {
			continue;
		}

		// Extract color tokens from the value (split on whitespace, try each)
		for (const token of value.split(/\s+/)) {
			const norm = normalizeColor(token);
			const varName = norm ? colorMap.get(norm) : undefined;
			if (varName) {
				for (const p of propsToCheck) {
					violations.push({
						elementId,
						property: p,
						value: token,
						suggestion: `Use ${varName} instead of ${token}`,
					});
				}
				break; // one violation per property is enough
			}
		}
	}

	return violations;
}

/** Check font-family against charte font tokens */
function checkFont(
	styleMap: Map<string, string>,
	charte: Charte,
	elementId: string,
): CharteViolation[] {
	const fonts = charte.tokens?.font;
	if (!fonts || Object.keys(fonts).length === 0) return [];

	const value = styleMap.get("font-family");
	if (!value) return [];
	// Already using a charte var → OK
	if (value.includes("var(--charte-font-")) return [];

	const available = Object.keys(fonts)
		.map((k) => `var(--charte-font-${k})`)
		.join(" or ");
	return [
		{
			elementId,
			property: "font-family",
			value,
			suggestion: `Use ${available}`,
		},
	];
}

/** Check box-shadow against charte shadow tokens */
function checkShadow(
	styleMap: Map<string, string>,
	charte: Charte,
	elementId: string,
): CharteViolation[] {
	const shadows = charte.tokens?.shadow;
	if (!shadows || Object.keys(shadows).length === 0) return [];

	const value = styleMap.get("box-shadow");
	if (!value) return [];
	// Already using a charte var, or explicitly none → OK
	if (value.includes("var(--charte-shadow-")) return [];
	if (value === "none" || value === "unset" || value === "initial") return [];

	const available = Object.keys(shadows)
		.map((k) => `var(--charte-shadow-${k})`)
		.join(" or ");
	return [
		{
			elementId,
			property: "box-shadow",
			value,
			suggestion: `Use ${available}`,
		},
	];
}

/**
 * Check HTML compliance against a charte's design tokens.
 * Returns violations for hardcoded colors (matching token values),
 * hardcoded fonts, and hardcoded shadows.
 */
export function checkCharteCompliance(
	html: string,
	charte: Charte,
): CharteViolation[] {
	if (!charte.tokens) return [];

	const colorMap = buildColorMap(charte);
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const violations: CharteViolation[] = [];

	for (const el of document.body.querySelectorAll("*")) {
		const style = (el as any).getAttribute("style");
		if (!style) continue;

		const elementId = (el as any).getAttribute("data-id") || "(no id)";
		const styleMap = parseStyle(style);

		violations.push(...checkColors(styleMap, colorMap, elementId));
		violations.push(...checkFont(styleMap, charte, elementId));
		violations.push(...checkShadow(styleMap, charte, elementId));
	}

	return violations;
}
