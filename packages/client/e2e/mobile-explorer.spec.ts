import { createDocument, expect, openWorkspace, test } from "./workspace-test";

test.describe("touch explorer", () => {
	test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
	for (const width of [344, 690])
		test(`hierarchical navigation and simple selection at ${width}`, async ({
			page,
			mcp,
		}) => {
			test.setTimeout(60000);
			await page.setViewportSize({ width, height: 800 });
			for (const name of ["Explorer A", "Explorer B"])
				await createDocument(mcp, name, {
					category: "Folder/Subfolder",
					html: `<main data-id="body"><h1 data-id="title">${name}</h1></main>`,
				});
			await mcp.call("maket_structured_workspace", {
				action: "create",
				workspace: "Explorer workspace",
				data_schema: {
					type: "object",
					properties: { id: { type: "string" } },
					required: ["id"],
				},
				representation_schema: {
					collections: { inbox: { name: "Inbox", identity: "/id" } },
				},
			});
			await openWorkspace(page);
			const navigation = page.locator("[data-mobile-reading-navigation]");
			await navigation
				.getByRole("button", { name: "Documents", exact: true })
				.click();
			const explorer = page.locator("[data-mobile-explorer]");
			if (!(await explorer.isVisible()))
				await navigation
					.getByRole("button", { name: "Documents", exact: true })
					.click();
			await explorer
				.locator("[data-mobile-explorer-entry]")
				.filter({ hasText: "Folder" })
				.click();
			await explorer
				.locator("[data-mobile-explorer-entry]")
				.filter({ hasText: "Subfolder" })
				.click();
			const a = explorer
				.locator("[data-mobile-explorer-entry]")
				.filter({ hasText: "Explorer A" });
			await expect(a.locator("img")).toBeVisible();
			await expect
				.poll(() =>
					a
						.locator("img")
						.evaluate((el) => (el as HTMLImageElement).naturalWidth),
				)
				.toBeGreaterThan(0);
			const box = await a.boundingBox();
			expect(box?.height).toBeGreaterThanOrEqual(48);
			await expect(a.locator("span.font-semibold").first()).toHaveCSS(
				"font-size",
				"16px",
			);
			await a.getByRole("button", { name: "Explorer A", exact: true }).click();
			await expect(
				page
					.locator("[data-reading-workspace]")
					.getByRole("heading", { name: "Explorer A", exact: true }),
			).toBeVisible();
			await page
				.getByRole("button", { name: /^Open (folder|workspace): / })
				.click();
			await expect(
				page.locator("[data-reader-zoom-controls]"),
			).not.toBeVisible();
			await expect(explorer.locator("[data-current]")).toHaveCount(1);
			await a.getByRole("button", { name: "Explorer A", exact: true }).click();
			await expect(
				page
					.locator("[data-reading-workspace]")
					.getByRole("heading", { name: "Explorer A", exact: true }),
			).toBeVisible();
			await page
				.getByRole("button", { name: /^Open (folder|workspace): / })
				.click();
			await explorer
				.getByRole("button", { name: "List view", exact: true })
				.click();
			await expect(explorer.locator("img")).toHaveCount(0);
			await explorer
				.locator("[data-mobile-explorer-entry]")
				.filter({ hasText: "Explorer B" })
				.click();
			await expect(
				page
					.locator("[data-reading-workspace]")
					.getByRole("heading", { name: "Explorer B", exact: true }),
			).toBeVisible();
			await page
				.getByRole("button", { name: /^Open (folder|workspace): / })
				.click();
			await expect(explorer.locator("[data-current]")).toContainText(
				"Explorer B",
			);
			await explorer
				.getByRole("button", { name: "Up one level", exact: true })
				.click();
			await expect(
				explorer.getByRole("heading", { name: "Folder", exact: true }),
			).toBeVisible();
			const search = explorer.getByRole("searchbox", {
				name: "Search this library",
				exact: true,
			});
			await search.fill("Explorer A");
			await expect(
				explorer.locator("[data-mobile-explorer-entry]"),
			).toContainText("Explorer A");
			await page.setViewportSize({ width, height: 400 });
			const searchBox = await search.boundingBox();
			if (!searchBox) throw new Error("Missing search field");
			expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(400);
			await page.setViewportSize({ width, height: 800 });
			await navigation
				.getByRole("button", { name: "Workspaces", exact: true })
				.click();
			await explorer
				.locator("[data-mobile-explorer-entry]")
				.filter({ hasText: "Explorer workspace" })
				.click();
			await explorer
				.locator("[data-mobile-explorer-entry]")
				.filter({ hasText: "Inbox" })
				.click();
			await expect(page.locator("[data-structured-index-pane]")).toBeVisible();
			await page
				.getByRole("button", { name: /^Open (folder|workspace): / })
				.click();
			await expect(
				explorer.getByRole("heading", {
					name: "Explorer workspace",
					exact: true,
				}),
			).toBeVisible();
			await page.screenshot({
				path: test.info().outputPath(`maket-explorer-v7-${width}.png`),
			});
		});
});

test("mobile navigation preserves the existing desktop open documents", async ({
	page,
	mcp,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openWorkspace(page);
	await createDocument(mcp, "Desktop A");
	await createDocument(mcp, "Desktop B");
	await page.getByRole("button", { name: "Document", exact: true }).click();
	await expect(page.getByRole("option", { name: /Desktop A/ })).toBeVisible();
	await expect(page.getByRole("option", { name: /Desktop B/ })).toBeVisible();
	await page.getByRole("button", { name: "Document", exact: true }).click();
	await page.setViewportSize({ width: 344, height: 800 });
	await page
		.locator("[data-mobile-reading-navigation]")
		.getByRole("button", { name: "Documents", exact: true })
		.click();
	const explorer = page.locator("[data-mobile-explorer]");
	if (!(await explorer.isVisible()))
		await page
			.locator("[data-mobile-reading-navigation]")
			.getByRole("button", { name: "Documents", exact: true })
			.click();
	await explorer
		.getByRole("searchbox", { name: "Search this library", exact: true })
		.fill("Desktop A");
	await explorer
		.locator("[data-mobile-explorer-entry]")
		.filter({ hasText: "Desktop A" })
		.click();
	await expect(
		page
			.locator("[data-reading-workspace]")
			.getByRole("heading", { name: "Desktop A", exact: true }),
	).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByRole("button", { name: "Document", exact: true }).click();
	await expect(page.getByRole("option", { name: /Desktop A/ })).toBeVisible();
	await expect(page.getByRole("option", { name: /Desktop B/ })).toBeVisible();
});
