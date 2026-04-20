import { afterEach, describe, expect, it, vi } from "vitest";
import { measurePageLayout, translateBubble } from "./ws";

// jsdom returns all-zero DOMRects; we stub getBoundingClientRect on a per-node
// basis so measurePageLayout sees real geometry. Each test sets up a page
// rectangle + child rectangles, then asserts the derived fields.
function rect(
	top: number,
	left: number,
	bottom: number,
	right: number,
): DOMRect {
	return {
		top,
		left,
		bottom,
		right,
		width: right - left,
		height: bottom - top,
		x: left,
		y: top,
		toJSON: () => ({}),
	};
}

function setRect(el: HTMLElement, r: DOMRect) {
	vi.spyOn(el, "getBoundingClientRect").mockReturnValue(r);
}

function makePage(
	pageRect: DOMRect,
	children: Array<{ id: string; name?: string; rect: DOMRect }>,
	scroll: { h: number; w: number } = {
		h: pageRect.height,
		w: pageRect.width,
	},
): HTMLElement {
	const page = document.createElement("div");
	setRect(page, pageRect);
	Object.defineProperty(page, "scrollHeight", { value: scroll.h });
	Object.defineProperty(page, "scrollWidth", { value: scroll.w });
	for (const child of children) {
		const el = document.createElement("div");
		el.dataset.id = child.id;
		if (child.name) el.dataset.name = child.name;
		setRect(el, child.rect);
		page.appendChild(el);
	}
	document.body.appendChild(page);
	return page;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("measurePageLayout", () => {
	it("reports no overflow when all elements fit inside the page", () => {
		const page = makePage(rect(0, 0, 400, 300), [
			{ id: "a", rect: rect(10, 10, 50, 50) },
			{ id: "b", rect: rect(60, 60, 200, 200) },
		]);
		const out = measurePageLayout(page);
		expect(out.overflow).toBe(false);
		expect(out.overflowing).toEqual([]);
		expect(out.containerHeight).toBe(400);
		expect(out.containerWidth).toBe(300);
		expect(out.overflowBy).toBe(0);
		expect(out.overflowByW).toBe(0);
	});

	it("flags vertical overflow and lists the offending element", () => {
		const page = makePage(
			rect(0, 0, 200, 300),
			[{ id: "big", rect: rect(10, 10, 260, 100) }],
			{ h: 260, w: 300 },
		);
		const out = measurePageLayout(page);
		expect(out.overflow).toBe(true);
		expect(out.overflowing).toContain("big");
		expect(out.contentHeight).toBeGreaterThanOrEqual(260);
		expect(out.overflowBy).toBeGreaterThan(0);
	});

	it("flags horizontal overflow independently", () => {
		const page = makePage(
			rect(0, 0, 400, 200),
			[{ id: "wide", rect: rect(10, 10, 100, 260) }],
			{ h: 400, w: 260 },
		);
		const out = measurePageLayout(page);
		expect(out.overflow).toBe(true);
		expect(out.overflowing).toContain("wide");
		expect(out.overflowByW).toBeGreaterThan(0);
	});

	it("translates element coordinates into page-local space", () => {
		const page = makePage(rect(50, 100, 450, 400), [
			{ id: "child", rect: rect(70, 120, 90, 140) },
		]);
		const out = measurePageLayout(page);
		expect(out.elements[0]).toMatchObject({
			id: "child",
			top: 20,
			left: 20,
			bottom: 40,
			right: 40,
			overflow: false,
		});
	});

	it("falls back to data-name when data-id is missing (not produced here but field is preserved)", () => {
		const page = makePage(rect(0, 0, 400, 300), [
			{ id: "a", name: "Title", rect: rect(10, 10, 50, 50) },
		]);
		const out = measurePageLayout(page);
		expect(out.elements[0].name).toBe("Title");
	});

	it("handles empty pages", () => {
		const page = makePage(rect(0, 0, 100, 100), []);
		const out = measurePageLayout(page);
		expect(out.overflow).toBe(false);
		expect(out.elements).toEqual([]);
		expect(out.contentHeight).toBe(100);
	});
});

describe("translateBubble", () => {
	it("falls back to english when language is not fr/en", () => {
		vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
		expect(translateBubble("bubble_doc_save")).toBe("Document saved");
	});

	it("interpolates {param} placeholders", () => {
		vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
		expect(translateBubble("bubble_image_import", { name: "hero.jpg" })).toBe(
			"Image imported: hero.jpg",
		);
	});

	it("uses the fr dictionary when browser lang is fr", () => {
		vi.spyOn(navigator, "language", "get").mockReturnValue("fr-CA");
		expect(translateBubble("bubble_image_import", { name: "hero.jpg" })).toBe(
			"Image importée : hero.jpg",
		);
	});

	it("falls back to bubble_default when the key is unknown", () => {
		vi.spyOn(navigator, "language", "get").mockReturnValue("en");
		const result = translateBubble("does_not_exist");
		// bubble_default must exist in en.json for this fallback to kick in
		expect(result).toBeTruthy();
		expect(result).not.toBe("does_not_exist");
	});

	it("returns empty string when key is undefined", () => {
		expect(translateBubble(undefined)).toBe("");
	});
});
