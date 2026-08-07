import { describe, expect, it } from "vitest";
import {
	enumAnchorIntersectsViewport,
	positionEnumPopover,
} from "./StateEnumSelect";

describe("positionEnumPopover", () => {
	it("keeps the enum list inside the viewport and flips above when needed", () => {
		const anchor = {
			top: 540,
			bottom: 570,
			left: 760,
			width: 120,
		} as DOMRect;

		expect(positionEnumPopover(anchor, 6, { width: 800, height: 600 })).toEqual(
			{
				top: 312,
				left: 612,
				width: 180,
				maxHeight: 224,
			},
		);
	});

	it("keeps a stable screen width when the transformed anchor grows", () => {
		const viewport = { width: 1000, height: 800 };
		const compact = positionEnumPopover(
			{ top: 100, bottom: 130, left: 100, width: 90 } as DOMRect,
			3,
			viewport,
		);
		const zoomed = positionEnumPopover(
			{ top: 100, bottom: 190, left: 100, width: 420 } as DOMRect,
			3,
			viewport,
		);

		expect(compact.width).toBe(180);
		expect(zoomed.width).toBe(compact.width);
	});

	it("caps the menu to the larger available side in a short viewport", () => {
		const position = positionEnumPopover(
			{ top: 80, bottom: 110, left: 100, width: 90 } as DOMRect,
			20,
			{ width: 300, height: 180 },
		);

		expect(position).toEqual({
			top: 8,
			left: 100,
			width: 180,
			maxHeight: 68,
		});
	});
});

describe("enumAnchorIntersectsViewport", () => {
	const viewport = { width: 800, height: 600 };

	it("keeps an anchor that still intersects the viewport", () => {
		expect(
			enumAnchorIntersectsViewport(
				{ top: -10, bottom: 10, left: 100, right: 220 } as DOMRect,
				viewport,
			),
		).toBe(true);
	});

	it("rejects anchors entirely above or below the viewport", () => {
		expect(
			enumAnchorIntersectsViewport(
				{ top: -40, bottom: 0, left: 100, right: 220 } as DOMRect,
				viewport,
			),
		).toBe(false);
		expect(
			enumAnchorIntersectsViewport(
				{ top: 600, bottom: 640, left: 100, right: 220 } as DOMRect,
				viewport,
			),
		).toBe(false);
	});
});
