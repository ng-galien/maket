import { describe, expect, it } from "vitest";
import {
	clampPanelWidth,
	initialPanelWidth,
	loadPanelWidth,
	savePanelWidth,
} from "./sidePanelResize";

describe("clampPanelWidth", () => {
	it("keeps the resizable panel within useful desktop bounds", () => {
		expect(clampPanelWidth(240, 1200)).toBe(320);
		expect(clampPanelWidth(540, 1200)).toBe(540);
		expect(clampPanelWidth(900, 1200)).toBe(760);
		expect(clampPanelWidth(760, 640)).toBe(624);
	});

	it("starts from the responsive panel width", () => {
		expect(initialPanelWidth(1200)).toBe(396);
		expect(initialPanelWidth(700)).toBe(350);
	});

	it("persists the unified V2 navigation width", () => {
		savePanelWidth("library", 512);
		expect(loadPanelWidth("library", 1200)).toBe(512);
	});
});
