import { createDocument, expect, openWorkspace, test } from "./workspace-test";

test.use({ hasTouch: true });
for (const width of [344, 360, 768, 1440]) {
	test(`mobile hierarchy and browser history remain distinct at ${width}px`, async ({
		page,
		mcp,
	}) => {
		await page.setViewportSize({ width, height: 740 });
		const name = "Organisation des mails et procédures";
		await createDocument(mcp, name, {
			category: "Municipal affairs/Organisation/Preparation",
		});
		await openWorkspace(page);
		const nav = page.locator("[data-mobile-reading-navigation]");
		await nav.getByRole("button", { name: "Documents", exact: true }).click();
		const explorer = page.locator("[data-mobile-explorer]");
		for (const category of [
			"Municipal affairs",
			"Organisation",
			"Preparation",
		]) {
			await explorer
				.getByRole("button", { name: category, exact: true })
				.click();
			await expect(explorer.getByRole("heading")).toContainText(category);
			await page.evaluate(
				() =>
					new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(resolve)),
					),
			);
		}
		await explorer.getByRole("button", { name, exact: true }).click();
		const header = page.locator("[data-mobile-simple-header]");
		await expect(header).toContainText(name);
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		await page.goBack();
		await expect(
			explorer.getByRole("heading", {
				name: "Municipal affairs/Organisation/Preparation",
				exact: true,
			}),
		).toBeVisible();
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		await page.goForward();
		await expect(header).toContainText(name);
		await header
			.getByRole("button", { name: "Open folder: Preparation", exact: true })
			.click();
		await expect(
			explorer.getByRole("heading", {
				name: "Municipal affairs/Organisation/Preparation",
				exact: true,
			}),
		).toBeVisible();
		await explorer
			.getByRole("button", { name: "Up one level", exact: true })
			.click();
		await expect(
			explorer.getByRole("heading", {
				name: "Municipal affairs/Organisation",
				exact: true,
			}),
		).toBeVisible();
		await nav.getByRole("button", { name: "Documents", exact: true }).click();
		await expect(
			explorer.getByRole("heading", { name: "Documents", exact: true }),
		).toBeVisible();
		await expect(
			explorer.getByRole("button", { name: "Municipal affairs", exact: true }),
		).toBeVisible();
		await nav.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(page.locator("[data-settings-page]")).toBeVisible();
		await page
			.locator("[data-settings-page]")
			.getByRole("button", { name: "Close settings", exact: true })
			.click();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(width);
	});
}
