import type { Page } from "@playwright/test";
import {
	closeLibrary,
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

async function checkReaderRoundTrip(
	page: Page,
	docName: string,
	layout: "single" | "split",
) {
	const navigation = page.locator("[data-structured-navigation]");
	const pane = navigation.locator("[data-structured-item-pane]");
	if (
		(await pane
			.locator("[data-collection-document-mode]")
			.getAttribute("data-collection-document-mode")) === "canvas"
	) {
		await pane
			.getByRole("button", { name: "Reading view", exact: true })
			.click();
	}
	await pane.getByRole("link", { name: "Read delivery notes" }).click();
	await expect(pane.locator("[data-reader-page-title]")).toHaveText([
		"Overview",
		"Delivery notes",
	]);
	const toggle = page.locator("[data-workspace-layout-toggle]");
	await toggle.click();
	await expect(navigation).toHaveAttribute(
		"data-layout",
		layout === "split" ? "single" : "split",
	);
	await expect(pane.locator(`[data-doc="${docName}"]`)).toBeVisible();
	await expect(
		pane.getByRole("heading", { name: /^Delivery notes for / }),
	).toBeInViewport();
	await toggle.click();
	await expect(navigation).toHaveAttribute("data-layout", layout);
	await expect(
		pane.getByRole("heading", { name: /^Delivery notes for / }),
	).toBeInViewport();
}

test.describe("Structured Workspace", () => {
	test("lists 120 items by batch: search narrows, load more extends, an item of the second batch opens", async ({
		mcp,
		page,
	}) => {
		const workspaceName = "Batched backlog";
		const title = (index: number) => `Task ${String(index).padStart(3, "0")}`;
		await openWorkspace(page);
		await mcp.call("maket_structured_workspace", {
			action: "create",
			workspace: workspaceName,
			data_schema: {
				type: "object",
				properties: { title: { type: "string" }, id: { type: "string" } },
				required: ["title", "id"],
				additionalProperties: false,
			},
			representation_schema: {
				collections: { items: { name: "Items", identity: "/id" } },
			},
		});
		for (let index = 1; index <= 120; index += 1)
			await mcp.call("maket_structured_workspace", {
				action: "add_item",
				workspace: workspaceName,
				item: `task-${index}`,
				collection: "items",
				binding: "item",
				document_name: title(index),
				data: { title: title(index), id: `task-${index}` },
			});

		const library = await openLibraryView(page, "structured-workspaces");
		const workspace = library
			.locator("[data-structured-workspace]")
			.filter({ hasText: workspaceName });
		await workspace.locator("button").first().click();
		await library
			.getByRole("button", { name: "Open collection index Items" })
			.click();

		const indexPane = page.locator("[data-structured-index-pane]");
		const count = indexPane.locator("[data-structured-index-count]");
		const card = (index: number) =>
			indexPane.locator(`[data-maket-document="${title(index)}"]`);
		await expect(count).toHaveText("50 of 120");
		await expect(card(50)).toHaveCount(1);
		await expect(card(51)).toHaveCount(0);

		const search = indexPane.getByRole("searchbox", {
			name: "Search this collection",
		});
		await search.fill("task 11");
		await search.press("Enter");
		await expect(count).toHaveText("10 of 10");
		await expect(card(110)).toHaveCount(1);
		await expect(card(1)).toHaveCount(0);
		await expect(indexPane.locator("[data-structured-index-more]")).toHaveCount(
			0,
		);

		await indexPane
			.getByRole("button", { name: "Clear the search", exact: true })
			.click();
		await expect(count).toHaveText("50 of 120");
		await indexPane.locator("[data-structured-index-more]").click();
		await expect(count).toHaveText("100 of 120");
		await expect(card(51)).toHaveCount(1);

		await card(75).click();
		const itemPane = page.locator("[data-structured-item-pane]");
		await expect(itemPane.locator(`[data-doc="${title(75)}"]`)).toBeVisible();
		await expect(count).toHaveText("100 of 120");
	});

	test("navigates between indexes and one current item in split and single views", async ({
		mcp,
		page,
	}) => {
		const workspaceName = "Delivery action journey";
		const collectionTemplate = "Delivery action board";
		const compactTemplate = "Delivery action card";
		const detailTemplate = "Delivery action detail";
		const itemDocument = "Ship the release";

		await openWorkspace(page);
		await createDocument(mcp, collectionTemplate, {
			html: '<main data-id="board"><section data-id="items" data-maket-structured-items="task"></section></main>',
		});
		await createDocument(mcp, compactTemplate, {
			html: '<article data-id="card" data-maket-compact-root><h2 data-id="title">{{ state.title }}</h2><button data-id="open" type="button" data-maket-action="open-document">Open {{ state.title }}</button></article>',
		});
		await createDocument(mcp, detailTemplate, {
			html: '<main data-id="detail"><h1 data-id="title">{{ state.title }}</h1><p data-id="proof">Detail opened from collection</p><a data-id="notes-link" href="#page=2">Read delivery notes</a></main>',
		});
		await mcp.call("maket_page", {
			action: "rename",
			doc: detailTemplate,
			page: 1,
			name: "Overview",
		});
		await mcp.call("maket_page", {
			action: "add",
			doc: detailTemplate,
			name: "Delivery notes",
			html: '<main data-id="notes"><h2 data-id="notes-title">Delivery notes for {{ state.title }}</h2></main>',
		});
		await mcp.call("maket_structured_workspace", {
			action: "create",
			workspace: workspaceName,
			data_schema: {
				$defs: {
					task: {
						type: "object",
						properties: {
							kind: { const: "task" },
							title: { type: "string" },
							id: { type: "string" },
						},
						required: ["kind", "title", "id"],
						additionalProperties: false,
					},
				},
				oneOf: [{ $ref: "#/$defs/task" }],
			},
			representation_schema: {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						identity: "/id",
						collectionTemplateDocumentId: collectionTemplate,
						bindings: {
							task: {
								schemaPath: "/$defs/task",
								compactTemplateDocumentId: compactTemplate,
								detailTemplateDocumentId: detailTemplate,
							},
						},
					},
				},
			},
		});
		await mcp.call("maket_structured_workspace", {
			action: "add_item",
			workspace: workspaceName,
			item: "release",
			collection: "backlog",
			binding: "task",
			document_name: itemDocument,
			data: { kind: "task", title: "Ship the release", id: "release" },
		});

		await mcp.call("maket_structured_workspace", {
			action: "add_item",
			workspace: workspaceName,
			item: "review",
			collection: "backlog",
			binding: "task",
			document_name: "Review the release",
			data: { kind: "task", title: "Review the release", id: "review" },
		});

		const library = await openLibraryView(page, "structured-workspaces");
		const workspace = library
			.locator("[data-structured-workspace]")
			.filter({ hasText: workspaceName });
		await expect(workspace).toBeVisible();
		await workspace.locator("button").first().click();
		await library
			.getByRole("button", { name: "Open collection index Backlog" })
			.click();

		const collectionDocument = `${workspaceName} — Backlog`;
		await expect(
			page.locator(`[data-doc="${collectionDocument}"]`),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Open Ship the release", exact: true })
			.click();

		const detail = page.locator(`[data-doc="${itemDocument}"]`);
		await expect(detail).toBeVisible();
		await expect(
			detail.getByText("Detail opened from collection"),
		).toBeVisible();
		const navigation = page.locator("[data-structured-navigation]");
		await expect(navigation).toHaveAttribute("data-layout", "split");
		await expect(
			library.locator("[data-structured-item], [data-structured-definition]"),
		).toHaveCount(0);
		const indexPane = navigation.locator("[data-structured-index-pane]");
		const itemPane = navigation.locator("[data-structured-item-pane]");
		await expect(async () => {
			const [left, right] = await navigation
				.locator("[data-structured-index-pane], [data-structured-item-pane]")
				.evaluateAll((panes) =>
					panes.map((pane) => {
						const bounds = pane.getBoundingClientRect();
						return { left: bounds.left, right: bounds.right };
					}),
				);
			expect(left && right && left.right <= right.left + 1).toBe(true);
		}).toPass();

		// Reader starts with native scrolling; opt in to canvas wheel zoom per pane.
		const zoom = (pane: typeof indexPane) =>
			pane
				.locator("[data-reader-zoom]")
				.evaluate((node) => (node as HTMLElement).style.zoom);
		await indexPane
			.locator("[data-collection-document-mode]")
			.getByRole("button", { name: "Canvas view", exact: true })
			.click();
		await itemPane
			.getByRole("button", { name: "Canvas view", exact: true })
			.click();
		await expect(library).toHaveAttribute("data-library-mode", "compact");
		await expect(async () => {
			const bounds = await indexPane.boundingBox();
			expect(bounds?.width).toBeGreaterThan(220);
		}).toPass();
		const wheel = async (pane: typeof indexPane, delta: number) => {
			const bounds = await pane
				.locator("[data-reading-workspace]")
				.boundingBox();
			if (!bounds) throw new Error("Missing reader pane");
			await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 200);
			await page.mouse.wheel(0, delta);
		};
		const rightBefore = await zoom(itemPane);
		const leftInitial = await zoom(indexPane);
		await wheel(indexPane, -100);
		await expect
			.poll(async () => Number(await zoom(indexPane)))
			.toBeGreaterThan(Number(leftInitial));
		expect(await zoom(itemPane)).toBe(rightBefore);
		const leftBefore = await zoom(indexPane);
		await wheel(itemPane, -100);
		await expect
			.poll(async () => Number(await zoom(itemPane)))
			.toBeGreaterThan(Number(rightBefore));
		expect(await zoom(indexPane)).toBe(leftBefore);
		await expect(navigation.locator("[data-reader-zoom-controls]")).toHaveCount(
			0,
		);
		// Panning is local to the zoomed pane; controls and forms remain clickable.
		const rightRoot = itemPane.locator("[data-reading-workspace]");
		for (let step = 0; step < 8; step++) await wheel(itemPane, -100);
		await expect(rightRoot).toHaveAttribute("data-reader-pannable", "");
		const beforePan = await rightRoot.evaluate((root) => root.scrollTop);
		const indexScroll = await indexPane
			.locator("[data-reading-workspace]")
			.evaluate((root) => root.scrollTop);
		const panBounds = await rightRoot.boundingBox();
		if (!panBounds) throw new Error("Missing reader pane");
		await page.mouse.move(panBounds.x + 70, panBounds.y + 240);
		await page.mouse.down();
		await page.mouse.move(panBounds.x + 30, panBounds.y + 160, { steps: 5 });
		await page.mouse.up();
		expect(await rightRoot.evaluate((root) => root.scrollTop)).toBeGreaterThan(
			beforePan,
		);
		expect(
			await indexPane
				.locator("[data-reading-workspace]")
				.evaluate((root) => root.scrollTop),
		).toBe(indexScroll);
		const pointX = panBounds.x + 150,
			pointY = panBounds.y + 250;
		const pointInDocument = async () =>
			itemPane.locator("[data-reader-zoom]").evaluate(
				(node, point) => {
					const bounds = node.getBoundingClientRect();
					const scale = Number((node as HTMLElement).style.zoom);
					return {
						x: (point.x - bounds.left) / scale,
						y: (point.y - bounds.top) / scale,
					};
				},
				{ x: pointX, y: pointY },
			);
		const anchorBefore = await pointInDocument();
		const zoomBefore = await zoom(itemPane);
		await page.mouse.move(pointX, pointY);
		await page.mouse.wheel(0, 100);
		await expect
			.poll(async () => Number(await zoom(itemPane)))
			.toBeLessThan(Number(zoomBefore));
		const anchorAfter = await pointInDocument();
		expect(Math.abs(anchorAfter.x - anchorBefore.x)).toBeLessThan(2);
		expect(Math.abs(anchorAfter.y - anchorBefore.y)).toBeLessThan(2);
		await itemPane.getByRole("button", { name: /^Fit/ }).click();
		// A keyboard shortcut targets the focused pane only.
		await page.mouse.click(panBounds.x + 70, panBounds.y + 240);
		const indexZoom = await zoom(indexPane);
		const itemZoom = await zoom(itemPane);
		await page.keyboard.press("+");
		expect(await zoom(indexPane)).toBe(indexZoom);
		expect(Number(await zoom(itemPane))).toBeGreaterThan(Number(itemZoom));
		await itemPane.getByRole("button", { name: /^Fit/ }).click();
		const separator = navigation.getByRole("separator", {
			name: "Resize index and item panels",
		});
		await separator.focus();
		await separator.press("ArrowRight");
		await expect(separator).toHaveAttribute("aria-valuenow", "30");
		const grip = await separator.boundingBox();
		if (!grip) throw new Error("Missing split handle");
		await page.mouse.move(grip.x + grip.width / 2, grip.y + 120);
		await page.mouse.down();
		await page.mouse.move(grip.x + 100, grip.y + 120, { steps: 5 });
		await page.mouse.up();
		expect(
			Number(await separator.getAttribute("aria-valuenow")),
		).toBeGreaterThan(30);
		await separator.dblclick();
		await expect(separator).toHaveAttribute("aria-valuenow", "28");
		await checkReaderRoundTrip(page, itemDocument, "split");

		// Pins are durable collection shortcuts, not a second list of all items.
		await itemPane
			.getByRole("button", { name: `Pin ${itemDocument}`, exact: true })
			.click();
		await expect(
			itemPane.getByRole("button", {
				name: `Unpin ${itemDocument}`,
				exact: true,
			}),
		).toBeVisible();
		const pinSnapshot = await mcp.callJson<{
			pinnedItems: { documentName: string; pinnedAt: string }[];
		}>("maket_structured_workspace", {
			action: "view",
			workspace: workspaceName,
		});
		expect(
			pinSnapshot.pinnedItems.find((item) => item.documentName === itemDocument)
				?.pinnedAt,
		).toBeTruthy();
		const pinLibrary = await openLibraryView(page, "structured-workspaces");
		const pinnedRow = pinLibrary
			.locator("[data-structured-item]")
			.filter({ hasText: itemDocument });
		await expect(pinnedRow).toBeVisible();
		await pinnedRow
			.getByRole("button", { name: `Unpin ${itemDocument}`, exact: true })
			.click();
		await expect(pinnedRow).toHaveCount(0);
		await expect(
			itemPane.locator(`[data-doc="${itemDocument}"]`),
		).toBeVisible();
		await mcp.call("maket_doc", { action: "pin", doc: itemDocument });
		await closeLibrary(page);

		await indexPane
			.getByRole("button", { name: "Open Review the release", exact: true })
			.click();
		await expect(
			itemPane.locator('[data-doc="Review the release"]'),
		).toBeVisible();
		await expect(
			navigation.locator('[data-doc="Ship the release"]'),
		).toHaveCount(0);
		await expect(navigation.locator("[data-doc]")).toHaveCount(2);
		await itemPane
			.getByRole("button", { name: "Close Review the release", exact: true })
			.click();
		await expect(navigation).toHaveAttribute("data-layout", "split");
		await expect(navigation.locator("[data-structured-item-pane]")).toHaveCount(
			1,
		);
		await expect(itemPane.locator("[data-doc]")).toHaveCount(0);
		await page.locator("[data-workspace-layout-toggle]").click();
		await expect(navigation).toHaveAttribute("data-layout", "single");
		await indexPane
			.getByRole("button", { name: "Open Ship the release", exact: true })
			.click();
		await expect(navigation).toHaveAttribute("data-layout", "single");
		await expect(indexPane).toBeHidden();
		await expect(navigation.locator("[data-doc]:visible")).toHaveCount(1);
		await checkReaderRoundTrip(page, itemDocument, "single");
		await itemPane
			.getByRole("button", { name: "Close Ship the release", exact: true })
			.click();
		await expect(indexPane).toBeVisible();
		await expect(navigation.locator("[data-structured-item-pane]")).toHaveCount(
			0,
		);
		await page.locator("[data-workspace-layout-toggle]").click();
		await indexPane
			.getByRole("button", { name: "Open Ship the release", exact: true })
			.click();

		await expect(
			itemPane.locator(`[data-doc="${itemDocument}"]`),
		).toBeVisible();
		await page.reload();
		await expect(page.locator("[data-structured-navigation]")).toHaveAttribute(
			"data-layout",
			"split",
		);
		await expect(
			indexPane.locator(`[data-doc="${collectionDocument}"]`),
		).toBeVisible();
		await expect(
			itemPane.locator(`[data-doc="${itemDocument}"]`),
		).toBeVisible();

		await expect(
			itemPane.getByRole("button", {
				name: `Unpin ${itemDocument}`,
				exact: true,
			}),
		).toBeVisible();
		await itemPane
			.getByRole("button", { name: `Close ${itemDocument}`, exact: true })
			.click();
		const restoredLibrary = await openLibraryView(
			page,
			"structured-workspaces",
		);
		await restoredLibrary
			.locator("[data-structured-item]")
			.getByRole("button", { name: itemDocument, exact: true })
			.click();
		await expect(
			itemPane.locator(`[data-doc="${itemDocument}"]`),
		).toBeVisible();
		const picker = page
			.locator("[data-workspace-header]")
			.getByRole("button", { name: "Document", exact: true });
		await picker.click();
		const menu = page.locator("[data-reader-menu]");
		for (const name of [itemDocument, collectionDocument]) {
			await expect(
				menu.getByRole("option", { name, exact: true }),
			).toBeVisible();
			await expect(
				menu.locator(`[data-open-document-pin="${name}"]`),
			).toHaveCount(name === itemDocument ? 1 : 0);
		}
		await picker.press("Escape");
		await expect(menu).toHaveCount(0);
		for (const name of [itemDocument, collectionDocument, detailTemplate]) {
			const link = await mcp.callJson<{ documentId: string; path: string }>(
				"maket_doc",
				{ action: "link", doc: name },
			);
			const phone = await page.context().newPage();
			await phone.setViewportSize({ width: 412, height: 915 });
			try {
				await phone.goto(link.path);
				await expect(
					phone.locator(`[data-linked-document="${link.documentId}"]`),
				).toBeVisible();
				await expect(phone.getByText("Document not found.")).toHaveCount(0);
			} finally {
				await phone.close();
			}
		}
		await expect(
			page.getByText(
				`Document "${itemDocument}" must be opened from its Workspace tree.`,
			),
		).toHaveCount(0);
	});
});
