import { expect, test } from "./isolated-test";
import { closeLibrary, openLibraryView } from "./workspace-test";

// Verifies that UI preferences persist to localStorage and are restored
// on reload — the Zustand store's init path runs against a real browser.

test.describe("Preferences persistence", () => {
	test("theme selection survives a reload", async ({ page }) => {
		await page.goto("/");
		// Start from a known state so previous tests can't bleed in.
		await page.evaluate(() =>
			localStorage.setItem("maket-theme-mode", "light"),
		);
		await page.reload();

		await page
			.getByRole("button", { name: /^(Settings|Paramètres)$/i })
			.click();
		await page.getByRole("button", { name: /^(Dark|Sombre)$/i }).click();
		// The store writes the flag synchronously.
		expect(
			await page.evaluate(() => localStorage.getItem("maket-theme-mode")),
		).toBe("dark");

		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await page
			.getByRole("button", { name: /^(Settings|Paramètres)$/i })
			.click();
		await expect(
			page.getByRole("button", { name: /^(Dark|Sombre)$/i }),
		).toHaveAttribute("aria-pressed", "true");
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
