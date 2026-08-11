import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// The starter bundles in starters/ are the blank-page fix and the demo's raw
// material — each must open in the standalone viewer and render its content.
// Regenerate with: npx tsx scripts/make-starter-bundles.ts

const STARTERS = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"starters",
);

async function openStarter(
	page: import("@playwright/test").Page,
	file: string,
	docName: string,
) {
	await page.goto("/viewer.html");
	await page.setInputFiles('input[type="file"]', path.join(STARTERS, file));
	await expect(page.locator(`[data-doc="${docName}"]`)).toBeVisible();
}

test.describe("Starter bundles", () => {
	test("event-poster: charte typography and artwork render", async ({
		page,
	}) => {
		await openStarter(page, "event-poster.maket", "event-poster");
		const canvas = page.locator('[data-doc="event-poster"] .page-canvas');
		await expect(
			canvas.getByRole("heading", { name: "MIDNIGHT BRASS FESTIVAL" }),
		).toBeVisible();
		await expect(canvas.getByText("Fri 13 – Sun 15 March · 8pm")).toBeVisible();
		await expect(canvas.locator('img[data-name="artwork"]')).toHaveAttribute(
			"src",
			/^blob:/,
		);
	});

	test("app-wireframe: all three screens render", async ({ page }) => {
		await openStarter(page, "app-wireframe.maket", "app-wireframe");
		const doc = page.locator('[data-doc="app-wireframe"]');
		await expect(doc.locator(".page-canvas")).toHaveCount(3);
		await expect(doc.getByText("Get started")).toBeVisible();
		await expect(doc.getByText("Market")).toBeVisible();
		await expect(doc.getByText("Pay now")).toBeVisible();
	});

	test("bistro-menu: full menu renders with illustration", async ({ page }) => {
		await openStarter(page, "bistro-menu.maket", "bistro-menu");
		const canvas = page.locator('[data-doc="bistro-menu"] .page-canvas');
		await expect(canvas.getByText("Chez Lucette")).toBeVisible();
		await expect(canvas.getByText("Steak frites")).toBeVisible();
		await expect(canvas.getByText("Paris-Brest")).toBeVisible();
	});

	test("social-series: four announcement cards fan out", async ({ page }) => {
		await openStarter(page, "social-series.maket", "launch-posts");
		const doc = page.locator('[data-doc="launch-posts"]');
		await expect(doc.locator(".page-canvas")).toHaveCount(4);
		await expect(
			doc.locator(".page-canvas").getByText("The Copper Section"),
		).toBeVisible();
	});

	test("product-catalog: collection fans out all six labels", async ({
		page,
	}) => {
		await openStarter(page, "product-catalog.maket", "price-labels");
		const doc = page.locator('[data-doc="price-labels"]');
		await expect(doc.locator(".page-canvas")).toHaveCount(6);
		const canvases = doc.locator(".page-canvas");
		await expect(canvases.getByText("Heritage Tomatoes")).toBeVisible();
		await expect(canvases.getByText("Walnut Oil")).toBeVisible();
		await expect(canvases.getByText("11,90 €")).toBeVisible();
		// Every label carries the shared logo asset from the bundle.
		await expect(doc.locator('img[data-name="logo"]')).toHaveCount(6);
	});

	test("living-checklist: current state renders with native controls", async ({
		page,
	}) => {
		await openStarter(page, "living-checklist.maket", "opening-checklist");
		const doc = page.locator('[data-doc="opening-checklist"]');
		await expect(doc.getByText("validated state")).toBeVisible();
		await expect(doc.locator('input[type="checkbox"]')).toBeChecked();
		await expect(doc.locator('input[type="text"]')).toHaveValue("Nora");
		await expect(doc.locator("select")).toHaveValue("ready");

		await doc.locator('input[type="checkbox"]').uncheck();
		await doc.locator("select").selectOption("todo");
		await expect(doc.locator('input[type="checkbox"]')).not.toBeChecked();
		await expect(doc.locator("select")).toHaveValue("todo");
	});
});
