import { describe, expect, it } from "vitest";
import {
	defaultPlacedBox,
	millimetresPerPixel,
	movedBox,
	placedElementAt,
	resizedBox,
} from "./handEditing";

const A4 = { w: 210, h: 297 };
const box = { left: 20, top: 30, width: 80, height: 40 };

describe("hand editing geometry", () => {
	it("converts screen pixels to millimetres at any board zoom", () => {
		// 210 mm rendered at 100 % (≈ 793.7 px), 50 % and 200 %.
		const full = (210 * 96) / 25.4;
		for (const zoom of [0.5, 1, 2]) {
			const perPixel = millimetresPerPixel(210, full * zoom);
			expect(perPixel * full * zoom).toBeCloseTo(210, 6);
			expect(perPixel * 96 * zoom).toBeCloseTo(25.4, 6);
		}
		expect(millimetresPerPixel(210, 0)).toBe(0);
	});

	it("moves a box and keeps it inside the page", () => {
		expect(movedBox(box, 10.04, -5, A4)).toEqual({
			left: 30,
			top: 25,
			width: 80,
			height: 40,
		});
		expect(movedBox(box, 500, 500, A4)).toEqual({
			left: 130,
			top: 257,
			width: 80,
			height: 40,
		});
		expect(movedBox(box, -500, -500, A4)).toMatchObject({ left: 0, top: 0 });
	});

	it("resizes from a handle, keeps the opposite edges, a minimum size and the page bounds", () => {
		expect(resizedBox(box, "se", 10, 5, A4)).toEqual({
			left: 20,
			top: 30,
			width: 90,
			height: 45,
		});
		expect(resizedBox(box, "nw", 10, 10, A4)).toEqual({
			left: 30,
			top: 40,
			width: 70,
			height: 30,
		});
		expect(resizedBox(box, "w", 200, 0, A4)).toMatchObject({
			left: 98,
			width: 2,
		});
		expect(resizedBox(box, "e", 500, 0, A4)).toMatchObject({
			left: 20,
			width: 190,
		});
		expect(resizedBox(box, "n", 0, -100, A4)).toMatchObject({
			top: 0,
			height: 70,
		});
	});

	it("centres a new element on the page", () => {
		expect(defaultPlacedBox("text", A4)).toEqual({
			left: 65,
			top: 141,
			width: 80,
			height: 15,
		});
		expect(defaultPlacedBox("frame", { w: 52, h: 30 })).toEqual({
			left: 0,
			top: 0,
			width: 52,
			height: 30,
		});
	});

	it("finds the placed element under a pointer, ignoring flow elements and nested blocks", () => {
		const root = document.createElement("div");
		root.innerHTML = [
			'<div data-id="frame-1" style="position:absolute;left:10mm;top:10mm;width:20mm;height:20mm"></div>',
			'<div data-id="text-1" style="position:absolute;left:10mm;top:40mm;width:20mm;height:20mm"><span data-id="inner">x</span></div>',
			'<p data-id="flow">y</p>',
		].join("");
		const inner = root.querySelector('[data-id="inner"]');
		expect(placedElementAt(root, inner)?.dataset.id).toBe("text-1");
		expect(
			placedElementAt(root, root.querySelector('[data-id="frame-1"]'))?.dataset
				.id,
		).toBe("frame-1");
		expect(placedElementAt(root, root.querySelector("p"))).toBeNull();
		expect(placedElementAt(root, null)).toBeNull();
	});

	it("finds placed elements inside the canonical page root", () => {
		const content = document.createElement("div");
		content.innerHTML = [
			'<div data-id="page" style="position:relative;width:100%;height:100%">',
			'<div data-id="frame-1" style="position:absolute;left:10mm;top:10mm;width:20mm;height:20mm"></div>',
			"</div>",
		].join("");
		expect(
			placedElementAt(content, content.querySelector('[data-id="frame-1"]'))
				?.dataset.id,
		).toBe("frame-1");
		expect(
			placedElementAt(content, content.querySelector('[data-id="page"]')),
		).toBeNull();
	});
});
