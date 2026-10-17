import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.use({ hasTouch: true });

for (const width of [344, 690]) {
	test(`workspace touch journey at ${width}px`, async ({ page, mcp }) => {
		await page.setViewportSize({ width, height: 820 });
		await createDocument(mcp, "Mobile detail", {
			html: '<main data-id="detail" style="padding:12mm"><h1 data-id="title">{{ state.title }}</h1><p data-id="copy" style="margin-bottom:420mm">Read this item</p><p data-id="end">End of item</p></main>',
		});
		await mcp.call("maket_canvas", {
			doc: "Mobile detail",
			format: "AUTO",
			width: 80,
		});
		await createDocument(mcp, "Mobile index", {
			html: '<main data-id="index"><section data-id="items" data-maket-structured-items="item"></section></main>',
		});
		await createDocument(mcp, "Mobile card", {
			html: '<article data-id="card" data-maket-compact-root><button data-id="open" type="button" data-maket-action="open-document">Open {{ state.title }}</button></article>',
		});
		await mcp.call("maket_doc", {
			action: "meta",
			doc: "Mobile detail",
			responsive: true,
		});
		await mcp.call("maket_doc", {
			action: "meta",
			doc: "Mobile index",
			responsive: true,
		});
		await mcp.call("maket_structured_workspace", {
			action: "create",
			workspace: "Mobile follow-up",
			data_schema: {
				$defs: {
					item: {
						type: "object",
						properties: { title: { type: "string" }, id: { type: "string" } },
						required: ["title", "id"],
						additionalProperties: false,
					},
				},
				oneOf: [{ $ref: "#/$defs/item" }],
			},
			representation_schema: {
				collections: {
					items: {
						name: "Items",
						identity: "/id",
						collectionTemplateDocumentId: "Mobile index",
						bindings: {
							item: {
								schemaPath: "/$defs/item",
								compactTemplateDocumentId: "Mobile card",
								detailTemplateDocumentId: "Mobile detail",
							},
						},
					},
				},
			},
		});
		await mcp.call("maket_structured_workspace", {
			action: "add_item",
			workspace: "Mobile follow-up",
			collection: "items",
			binding: "item",
			item: "one",
			document_name: "Mobile task",
			data: { title: "Mobile task", id: "one" },
		});
		await mcp.call("maket_structured_workspace", {
			action: "create",
			workspace: "Other workspace",
			data_schema: {
				type: "object",
				properties: { id: { type: "string" } },
				required: ["id"],
			},
			representation_schema: {
				collections: { archive: { name: "Archive", identity: "/id" } },
			},
		});
		await openWorkspace(page);
		const library = await openLibraryView(page, "structured-workspaces");
		await library
			.getByRole("button", { name: "Mobile follow-up", exact: true })
			.tap();
		await library.getByRole("button", { name: "Items", exact: true }).tap();
		await expect(library).toBeHidden();
		const navigation = page.locator("[data-structured-navigation]");
		await expect(navigation).toHaveAttribute("data-layout", "single");
		await page
			.getByRole("button", { name: "Open Mobile task", exact: true })
			.tap();
		const item = page.locator("[data-structured-item-pane]");
		await expect(
			item.getByRole("heading", { name: "Mobile task" }),
		).toBeVisible();
		await page.screenshot({
			path: test.info().outputPath(`maket-mobile-${width}.png`),
		});
		const reader = item.locator("[data-reading-workspace]");
		const box = await reader.boundingBox();
		if (!box) throw new Error("Missing reader viewport");
		const session = await page.context().newCDPSession(page);
		await session.send("Input.synthesizeScrollGesture", {
			x: box.x + box.width / 2,
			y: box.y + box.height * 0.7,
			yDistance: -1600,
			speed: 1500,
			gestureSourceType: "touch",
		});
		await expect
			.poll(() => reader.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(0);
		await item.locator('[data-id="end"]').scrollIntoViewIfNeeded();
		await expect(item.locator('[data-id="end"]')).toBeInViewport();
		await item.getByRole("button", { name: "Back to list" }).tap();
		await expect(page.locator("[data-structured-index-pane]")).toBeVisible();
		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(navigation).toHaveAttribute("data-layout", "single");
		await page.setViewportSize({ width, height: 820 });
		await openLibraryView(page, "structured-workspaces");
		await library.getByRole("button", { name: "Items", exact: true }).tap();
		await expect(library).toBeHidden();
		await expect(navigation).toHaveAttribute("data-layout", "single");
		await openLibraryView(page, "structured-workspaces");
		await library
			.getByRole("button", { name: "Up one level", exact: true })
			.tap();
		await library
			.getByRole("button", { name: "Other workspace", exact: true })
			.tap();
		await library.getByRole("button", { name: "Archive", exact: true }).tap();
		await expect(library).toBeHidden();
		await expect(
			page
				.locator("[data-structured-index-pane]")
				.getByRole("heading", { name: "Archive", exact: true }),
		).toBeVisible();
		await page.reload();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(width);
	});
}
