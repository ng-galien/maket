import { describe, expect, it } from "vitest";
import { boardDocFrame } from "./boardGeometry";

function geometry(
	element: HTMLElement,
	values: {
		left: number;
		top: number;
		width: number;
		height: number;
		parent: HTMLElement | null;
	},
) {
	Object.defineProperties(element, {
		offsetLeft: { configurable: true, value: values.left },
		offsetTop: { configurable: true, value: values.top },
		offsetWidth: { configurable: true, value: values.width },
		offsetHeight: { configurable: true, value: values.height },
		offsetParent: { configurable: true, value: values.parent },
	});
}

describe("boardDocFrame", () => {
	it("uses stable layout offsets instead of transformed viewport rectangles", () => {
		const board = document.createElement("div");
		const doc = document.createElement("div");
		const page = document.createElement("div");
		geometry(doc, {
			left: 900,
			top: 40,
			width: 794,
			height: 1200,
			parent: board,
		});
		geometry(page, {
			left: 900,
			top: 160,
			width: 794,
			height: 1123,
			parent: doc,
		});

		expect(boardDocFrame(page)).toEqual({
			left: 900,
			top: 160,
			width: 794,
			height: 1123,
		});
	});

	it("keeps viewport-independent offsets when the browser exposes no offset parent", () => {
		const page = document.createElement("div");
		geometry(page, {
			left: 2166,
			top: 40,
			width: 794,
			height: 1123,
			parent: null,
		});

		expect(boardDocFrame(page)).toEqual({
			left: 2166,
			top: 40,
			width: 794,
			height: 1123,
		});
	});
});
