import type { Locator, Page } from "@playwright/test";
import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

for (const automatic of [false, true]) {
	for (const pinned of [false, true]) {
		test(`View reveals the whole document: automatic=${automatic}, pinned=${pinned}`, async ({
			mcp,
			page,
		}) => {
			// Exercise the desktop canvas, including the space taken by the library.
			await page.setViewportSize({ width: 1280, height: 1000 });
			await openWorkspace(page);
			const alpha = "Reveal two pages";
			const beta = "Other open document";
			await createDocument(mcp, alpha);
			await mcp.call("maket_page", {
				action: "add",
				doc: alpha,
				name: "Second",
				html: '<main data-id="second">Second page</main>',
			});
			await createDocument(mcp, beta);
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: alpha,
				page: 1,
			});
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: beta,
				page: 1,
			});
			await expect(
				page.locator(`[data-doc="${beta}"] [data-active-page="true"]`),
			).toBeVisible();
			await page.getByRole("button", { name: "Settings", exact: true }).click();
			await page
				.getByRole("group", { name: "Automatic repositioning", exact: true })
				.getByRole("button", { name: automatic ? "On" : "Off", exact: true })
				.click();
			await page.getByRole("button", { name: "Settings", exact: true }).click();
			const panel = await openLibraryView(page, "docs");
			if (pinned)
				await panel
					.getByRole("button", { name: "Pin navigation", exact: true })
					.click();
			const document = page.locator(`[data-doc="${alpha}"]`);
			await panel
				.getByRole("button", { name: `View ${alpha}`, exact: true })
				.click();
			await expect(document.locator('[data-active-page="true"]')).toHaveCount(
				1,
			);
			await expect(panel).toHaveAttribute("data-library-mode", "extended");
			await expectDocumentFramed(page, document);

			// Move the camera without changing selection: View must work again.
			const canvas = await page
				.locator("[data-canvas-workspace]")
				.boundingBox();
			if (!canvas) throw new Error("Missing canvas");
			await page.keyboard.down("Space");
			await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + 150);
			await page.mouse.down();
			await page.mouse.move(canvas.x + canvas.width / 2 + 180, canvas.y + 220, {
				steps: 10,
			});
			await page.mouse.up();
			await page.keyboard.up("Space");
			await expect
				.poll(() => centerOffset(page, document))
				.toBeGreaterThan(100);
			await openLibraryView(page, "docs");
			await panel
				.getByRole("button", { name: `View ${alpha}`, exact: true })
				.click();
			await expectDocumentFramed(page, document);
			await expect(panel).toHaveAttribute("data-library-mode", "extended");
		});
	}
}

async function centerOffset(page: Page, document: Locator): Promise<number> {
	const box = await document.boundingBox();
	const canvas = await page.locator("[data-canvas-workspace]").boundingBox();
	if (!box || !canvas) return Number.POSITIVE_INFINITY;
	return Math.max(
		Math.abs(box.x + box.width / 2 - canvas.x - canvas.width / 2),
		Math.abs(box.y + box.height / 2 - canvas.y - canvas.height / 2),
	);
}

async function expectDocumentFramed(
	page: Page,
	document: Locator,
): Promise<void> {
	await expect.poll(() => centerOffset(page, document)).toBeLessThan(12);
	await expect
		.poll(async () => {
			const box = await document.boundingBox();
			const canvas = await page
				.locator("[data-canvas-workspace]")
				.boundingBox();
			return Boolean(
				box &&
					canvas &&
					box.x >= canvas.x &&
					box.y >= canvas.y &&
					box.x + box.width <= canvas.x + canvas.width &&
					box.y + box.height <= canvas.y + canvas.height,
			);
		})
		.toBe(true);
}
