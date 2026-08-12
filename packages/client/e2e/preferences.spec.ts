import { expect, test } from "./isolated-test";

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

	test("bar position toggle survives a reload", async ({ page }) => {
		await page.goto("/");
		await page.evaluate(() => localStorage.setItem("bar-position", "bottom"));
		await page.reload();

		await page.getByTitle(/move to top/i).click();
		expect(
			await page.evaluate(() => localStorage.getItem("bar-position")),
		).toBe("top");

		await page.reload();
		await expect(page.getByTitle(/move to bottom/i)).toBeVisible();
	});
});
