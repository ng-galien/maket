import { beforeEach, describe, expect, it } from "vitest";
import {
	clampPanelWidth,
	initialPanelWidth,
	loadPanelWidth,
	savePanelWidth,
} from "./sidePanelResize";

describe("clampPanelWidth", () => {
	it("keeps a width inside the allowed range", () => {
		expect(clampPanelWidth(400, 1440)).toBe(400);
		expect(clampPanelWidth(120, 1440)).toBe(320);
		expect(clampPanelWidth(2000, 1440)).toBe(760);
	});

	it("leaves a gutter on narrow viewports", () => {
		expect(clampPanelWidth(760, 600)).toBe(584);
	});

	it("never collapses the panel on a degenerate viewport", () => {
		expect(clampPanelWidth(400, 0)).toBe(320);
		expect(clampPanelWidth(400, 10)).toBe(320);
		expect(clampPanelWidth(400, Number.NaN)).toBe(400);
		expect(clampPanelWidth(Number.NaN, 1440)).toBe(320);
	});
});

describe("initialPanelWidth", () => {
	it("scales with the viewport", () => {
		expect(initialPanelWidth(1440)).toBeCloseTo(475.2, 1);
		expect(initialPanelWidth(700)).toBe(350);
		expect(initialPanelWidth(400)).toBe(360);
	});

	it("stays usable when the viewport is not measurable yet", () => {
		expect(initialPanelWidth(0)).toBe(320);
	});
});

describe("loadPanelWidth", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("falls back to the responsive width when nothing is stored", () => {
		expect(loadPanelWidth("library", 1440)).toBeCloseTo(475.2, 1);
	});

	it("restores and clamps a stored width", () => {
		savePanelWidth("library", 512);
		expect(loadPanelWidth("library", 1440)).toBe(512);
		expect(loadPanelWidth("library", 600)).toBe(512);
		expect(loadPanelWidth("library", 500)).toBe(484);
	});

	it("ignores a corrupted stored width", () => {
		localStorage.setItem("maket-library-width", "not-a-number");
		expect(loadPanelWidth("library", 1440)).toBeCloseTo(475.2, 1);
		localStorage.setItem("maket-library-width", "-40");
		expect(loadPanelWidth("library", 1440)).toBeCloseTo(475.2, 1);
	});
});
