import { describe, expect, it } from "vitest";
import {
	accentContrastColor,
	applyAccentColor,
	applyColorScheme,
	DARK_ACCENT_CONTENT,
	LIGHT_ACCENT_CONTENT,
} from "./colorScheme";

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

describe("applyAccentColor", () => {
	it.each([
		["#ffffff", DARK_ACCENT_CONTENT],
		["#000000", LIGHT_ACCENT_CONTENT],
		["#10b981", DARK_ACCENT_CONTENT],
		["#777777", DARK_ACCENT_CONTENT],
	] as const)("derives readable content for %s", (accent, content) => {
		const root = document.createElement("html");

		applyAccentColor(accent, root);

		expect(root.style.getPropertyValue("--color-accent")).toBe(accent);
		expect(root.style.getPropertyValue("--color-accent-contrast")).toBe(
			content,
		);
		expect(accentContrastColor(accent)).toBe(content);
	});
});
