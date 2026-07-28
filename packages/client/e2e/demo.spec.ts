import { expect, test } from "@playwright/test";

// Acceptance for /demo.html: an honest replay of a recorded Maket session —
// explicit "Replayed session" labelling, stepping through real workspace
// states, and a download that round-trips back into the standalone viewer.

async function goToStep(page: import("@playwright/test").Page, index: number) {
	await page.getByRole("slider", { name: "Timeline" }).fill(String(index));
}

test.describe("Maket Demo", () => {
	test("loads with the replay labelling and the opening request", async ({
		page,
	}) => {
		await page.goto("/demo.html");
		await expect(page).toHaveTitle(/Maket Demo/i);
		await expect(page.getByText(/replayed session/i)).toBeVisible();
		await expect(page.getByTestId("demo-caption")).toContainText(
			"price labels for my farm shop",
		);
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
	});

	test("autoplay advances to the next step", async ({ page }) => {
		await page.goto("/demo.html");
		await expect(page.getByTestId("demo-caption")).toContainText(
			"drafts a first label template",
			{ timeout: 10_000 },
		);
		await expect(
			page.locator('[data-doc="price-labels"] .page-canvas'),
		).toBeVisible();
	});

	test("stepping to the annotation shows the user note badge", async ({
		page,
	}) => {
		await page.goto("/demo.html");
		await goToStep(page, 4);
		await expect(page.getByTestId("demo-caption")).toContainText(
			"stand out more",
		);
		await expect(page.locator(".has-note")).toHaveCount(1);
	});

	test("collection step fans out six labels with real data", async ({
		page,
	}) => {
		await page.goto("/demo.html");
		await goToStep(page, 7);
		const canvases = page.locator('[data-doc="price-labels"] .page-canvas');
		await expect(canvases).toHaveCount(6);
		await expect(canvases.getByText("Heritage Tomatoes")).toBeVisible();
		await expect(canvases.getByText("Walnut Oil")).toBeVisible();
		// Each rendered label carries its per-row image from the collection.
		await expect(canvases.locator('img[data-name="photo"]')).toHaveCount(6);
	});

	test("scenario picker switches to the event poster", async ({ page }) => {
		await page.goto("/demo.html");
		await page.getByRole("button", { name: "Poster", exact: true }).click();
		await expect(page.getByTestId("demo-caption")).toContainText(
			"brass festival",
		);
		await goToStep(page, 6);
		await expect(
			page
				.locator('[data-doc="event-poster"]')
				.getByRole("heading", { name: "MIDNIGHT BRASS FESTIVAL" }),
		).toBeVisible();
	});

	test("deep link ?scenario=app-wireframe shows the multi-page growth", async ({
		page,
	}) => {
		await page.goto("/demo.html?scenario=app-wireframe");
		await expect(page.getByTestId("demo-caption")).toContainText(
			"grocery-delivery",
		);
		await goToStep(page, 7);
		await expect(
			page.locator('[data-doc="app-wireframe"] .page-canvas'),
		).toHaveCount(3);
		await expect(
			page.locator('[data-doc="app-wireframe"]').getByText("Pay now"),
		).toBeVisible();
	});

	test("menu scenario builds section by section with dotted leaders", async ({
		page,
	}) => {
		await page.goto("/demo.html?scenario=bistro-menu");
		await expect(page.getByTestId("demo-caption")).toContainText("bistro");
		const canvas = page.locator('[data-doc="bistro-menu"] .page-canvas');
		await goToStep(page, 3);
		await expect(canvas.getByText("Leek vinaigrette")).toBeVisible();
		await expect(canvas.getByText("Paris-Brest")).toHaveCount(0);
		await goToStep(page, 9);
		await expect(canvas.getByText("Paris-Brest")).toBeVisible();
		await expect(canvas.getByText("Chez Lucette")).toBeVisible();
		await expect(canvas.locator('img[data-name="plate"]')).toHaveCount(1);
	});

	test("social series fans out one card per act", async ({ page }) => {
		await page.goto("/demo.html?scenario=social-series");
		await goToStep(page, 6);
		const canvases = page.locator('[data-doc="launch-posts"] .page-canvas');
		await expect(canvases).toHaveCount(4);
		await expect(canvases.getByText("Balkan Tide")).toBeVisible();
		await expect(canvases.getByText("DJ Mille-Feuille")).toBeVisible();
		await expect(canvases.locator('img[data-name="mark"]')).toHaveCount(4);
	});

	test("download round-trips into the standalone viewer", async ({ page }) => {
		await page.goto("/demo.html");
		await goToStep(page, 8);
		const downloadPromise = page.waitForEvent("download");
		await page.getByRole("button", { name: ".maket" }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe("product-catalog.maket");
		const file = await download.path();

		// The bundle the visitor takes home opens in the viewer.
		await page.goto("/viewer.html");
		await page.setInputFiles('input[type="file"]', file);
		const doc = page.locator('[data-doc="price-labels"]');
		await expect(doc).toBeVisible();
		await doc.getByRole("button", { name: "All rows" }).click();
		await expect(doc.locator(".page-canvas")).toHaveCount(6);
		await expect(
			doc.locator(".page-canvas").getByText("Raw Honey"),
		).toBeVisible();
	});
});
