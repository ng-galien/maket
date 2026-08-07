import { describe, expect, it } from "vitest";
import { applyColorScheme } from "./colorScheme";

describe("applyColorScheme", () => {
	it.each([
		[false, "light"],
		[true, "dark"],
	] as const)("applies the %s theme to the root", (darkMode, expected) => {
		const root = document.createElement("html");
		applyColorScheme(darkMode, root);
		expect(root.style.colorScheme).toBe(expected);
		expect(root.dataset.theme).toBe(expected);
	});
});
