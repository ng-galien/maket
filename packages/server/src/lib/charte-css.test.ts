import { describe, expect, it } from "vitest";
import type { Charte } from "../types.js";
import { charteFontImport } from "./charte-css.js";

function makeCharte(font: Record<string, string>): Charte {
	return { name: "test", tokens: { font } };
}

describe("charteFontImport", () => {
	it("emits @import for a clean family token", () => {
		const out = charteFontImport(makeCharte({ heading: "Inter, sans-serif" }));
		expect(out).toContain("https://fonts.googleapis.com/css2?");
		expect(out).toContain("family=Inter:");
	});

	it("space-separated family names use the `+` Google Fonts syntax", () => {
		const out = charteFontImport(
			makeCharte({ heading: "Source Sans 3, sans-serif" }),
		);
		expect(out).toContain("family=Source+Sans+3:");
	});

	it("returns an empty string when only generic families are declared", () => {
		expect(charteFontImport(makeCharte({ body: "sans-serif" }))).toBe("");
		expect(charteFontImport(makeCharte({ body: "system-ui" }))).toBe("");
	});

	it.each([
		"Inter&leak=secret",
		"Inter?leak=secret",
		"Inter=Inter",
		"Inter#fragment",
		"Inter/../",
	])("rejects family token containing URL-meaningful chars: %s", (raw) => {
		const out = charteFontImport(makeCharte({ heading: raw }));
		expect(out).toBe("");
	});

	it("only the safe family is kept when a charte mixes safe and unsafe tokens", () => {
		const out = charteFontImport(
			makeCharte({
				heading: "Inter, sans-serif",
				accent: "Evil&leak=x, sans-serif",
			}),
		);
		expect(out).toContain("family=Inter:");
		expect(out).not.toContain("Evil");
		expect(out).not.toContain("leak");
	});
});
