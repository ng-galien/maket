import { expect, test } from "./isolated-test";
import { closeLibrary, openLibraryView } from "./workspace-test";

// Verifies that UI preferences persist to localStorage and are restored
// on reload — the Zustand store's init path runs against a real browser.

test.describe("Preferences persistence", () => {
	test("dark mode toggle survives a reload", async ({ page }) => {
		await page.goto("/");
		// Start from a known state so previous tests can't bleed in.
		await page.evaluate(() => localStorage.setItem("dark-mode", "false"));
		await page.reload();

		const darkBtn = page.getByTitle(/^dark mode$/i);
		await darkBtn.click();
		// The store writes the flag synchronously.
		expect(await page.evaluate(() => localStorage.getItem("dark-mode"))).toBe(
			"true",
		);

		await page.reload();
		// Button title flips to "Light mode" once dark is active.
		await expect(page.getByTitle(/^light mode$/i)).toBeVisible();
	});

	test("library selection and visibility survive a reload", async ({
		page,
	}) => {
		await page.goto("/");
		await openLibraryView(page, "chartes");
		expect(
			await page.evaluate(() => localStorage.getItem("maket-library-view")),
		).toBe("chartes");
		await closeLibrary(page);
		expect(
			await page.evaluate(() => localStorage.getItem("maket-library-open")),
		).toBe("false");

		await page.reload();
		await expect(page.locator("[data-library-panel]")).toHaveAttribute(
			"data-library-mode",
			"compact",
		);
		const panel = await openLibraryView(page, "chartes");
		await expect(panel).toHaveAttribute("data-library-view", "chartes");
	});
});
