import { describe, expect, it } from "vitest";
import {
	clampPlacedBox,
	placedBoxFits,
	placedBoxFromStyle,
	placedCompositionFormat,
	placedContainer,
	styleWithPlacedBox,
} from "./placed-element.js";

describe("placed elements", () => {
	it("reads a placed box only from an absolute style in millimetres", () => {
		expect(
			placedBoxFromStyle(
				"position:absolute;left:20mm;top:30.5mm;width:80mm;height:40mm",
			),
		).toEqual({ left: 20, top: 30.5, width: 80, height: 40 });
		expect(
			placedBoxFromStyle(
				"position: absolute; LEFT: 1mm; top:2mm; width:3mm; height:4mm",
			),
		).toEqual({ left: 1, top: 2, width: 3, height: 4 });
		expect(
			placedBoxFromStyle(
				"position:relative;left:1mm;top:2mm;width:3mm;height:4mm",
			),
		).toBeNull();
		expect(
			placedBoxFromStyle(
				"position:absolute;left:1px;top:2mm;width:3mm;height:4mm",
			),
		).toBeNull();
		expect(placedBoxFromStyle(null)).toBeNull();
	});

	it("rewrites the box and keeps every other declaration in place", () => {
		expect(
			styleWithPlacedBox(
				"position:absolute;left:1mm;color:red;top:2mm;width:3mm;height:4mm",
				{ left: 10.04, top: 20, width: 30, height: 40 },
			),
		).toBe(
			"position:absolute;left:10mm;color:red;top:20mm;width:30mm;height:40mm",
		);
		expect(
			styleWithPlacedBox("position:absolute", {
				left: 1,
				top: 2,
				width: 3,
				height: 4,
			}),
		).toBe("position:absolute;left:1mm;top:2mm;width:3mm;height:4mm");
	});

	it("keeps a box inside the page and checks whether it fits", () => {
		expect(
			clampPlacedBox({ left: -5, top: 290, width: 300, height: 1 }, 210, 297),
		).toEqual({ left: 0, top: 290, width: 210, height: 2 });
		expect(
			placedBoxFits({ left: 0, top: 0, width: 210, height: 297 }, 210, 297),
		).toBe(true);
		expect(
			placedBoxFits({ left: 200, top: 0, width: 20, height: 20 }, 210, 297),
		).toBe(false);
		expect(
			placedBoxFits(
				{ left: Number.NaN, top: 0, width: 1, height: 1 },
				210,
				297,
			),
		).toBe(false);
	});

	it("places elements on every fixed format and in the page root", () => {
		expect(placedCompositionFormat("A4")).toBe(true);
		expect(placedCompositionFormat("AUTO")).toBe(false);
		const node = (
			id: string | null,
			children: unknown[] = [],
			style: string | null = null,
		) => ({
			children,
			getAttribute: (name: string) =>
				name === "data-id" ? id : name === "style" ? style : null,
		});
		const root = node("page");
		expect(placedContainer(node(null, [node("title"), root]))).toBe(root);
		const legacy = node("main");
		expect(placedContainer(node(null, [legacy]))).toBe(legacy);
		const content = node(null, [
			node(
				"frame-1",
				[],
				"position:absolute;left:1mm;top:1mm;width:1mm;height:1mm",
			),
		]);
		expect(placedContainer(content)).toBe(content);
	});
});
