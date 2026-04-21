import { describe, expect, it } from "vitest";
import type { Charte } from "../types.js";
import { checkCharteCompliance, parseStyle } from "./charte-check.js";

const CHARTE: Charte = {
	name: "brand",
	tokens: {
		color: {
			primary: "#FF0000",
			bg: "#112233",
		},
		font: {
			heading: "Fraunces",
			body: "Inter",
		},
		shadow: {
			card: "0 4px 20px rgba(0,0,0,0.2)",
		},
	},
};

describe("parseStyle", () => {
	it("extracts normalized property/value pairs from an inline style", () => {
		expect(parseStyle(" Color : #fff ; font-family: Inter ; invalid ")).toEqual(
			new Map([
				["color", "#fff"],
				["font-family", "Inter"],
			]),
		);
	});
});

describe("checkCharteCompliance", () => {
	it("flags hardcoded color tokens used in direct properties", () => {
		const out = checkCharteCompliance(
			'<h1 data-id="title" style="color:#ff0000;background-color: rgb(17,34,51)">Hello</h1>',
			CHARTE,
		);

		expect(out).toEqual([
			expect.objectContaining({
				elementId: "title",
				property: "color",
				suggestion: "Use var(--charte-color-primary) instead of #ff0000",
			}),
			expect.objectContaining({
				elementId: "title",
				property: "background-color",
				suggestion: "Use var(--charte-color-bg) instead of rgb(17,34,51)",
			}),
		]);
	});

	it("flags shorthand background colors but ignores gradients", () => {
		const plain = checkCharteCompliance(
			'<div data-id="hero" style="background:#112233">x</div>',
			CHARTE,
		);
		const gradient = checkCharteCompliance(
			'<div data-id="hero" style="background:linear-gradient(#112233,#ffffff)">x</div>',
			CHARTE,
		);

		expect(plain).toContainEqual(
			expect.objectContaining({
				elementId: "hero",
				property: "background",
			}),
		);
		expect(gradient).toEqual([]);
	});

	it("flags hardcoded fonts and shadows when charte tokens exist", () => {
		const out = checkCharteCompliance(
			'<section data-id="card" style="font-family: Georgia; box-shadow: 0 4px 20px rgba(0,0,0,0.2)">x</section>',
			CHARTE,
		);

		expect(out).toEqual([
			expect.objectContaining({
				elementId: "card",
				property: "font-family",
			}),
			expect.objectContaining({
				elementId: "card",
				property: "box-shadow",
			}),
		]);
	});

	it("ignores values already expressed through charte vars or explicit none", () => {
		const out = checkCharteCompliance(
			`<div data-id="ok" style="
				color:var(--charte-color-primary);
				font-family:var(--charte-font-heading);
				box-shadow:none;
				background:var(--charte-color-bg)
			">ok</div>`,
			CHARTE,
		);

		expect(out).toEqual([]);
	});

	it("uses a fallback id when the element has no data-id", () => {
		const out = checkCharteCompliance('<p style="color:#ff0000">x</p>', CHARTE);
		expect(out[0]?.elementId).toBe("(no id)");
	});
});
