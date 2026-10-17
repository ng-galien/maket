import type { StructuredWorkspaceView } from "@maket/shared";
import { swipeTouch } from "./touch-gesture";
import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.use({ hasTouch: true });

test("document opt-in reflows every reader page, survives a bundle, and preserves paper PDF", async ({
	page,
	mcp,
	baseURL,
}) => {
	test.setTimeout(90_000);
	const doc = "Responsive contract";
	const html =
		'<style>.reading-body{font:16px system-ui;padding:16px;--layout:wide}.long{min-height:1600px}@container(max-width:600px){.reading-body{--layout:narrow}}</style><main data-id="body" class="reading-body"><h1 data-id="title">Readable text</h1><div data-id="long" class="long">Long reading content</div><p data-id="end">End of page</p></main>';
	await createDocument(mcp, doc, { html });
	await mcp.call("maket_page", { action: "add", doc, name: "Second", html });
	await page.setViewportSize({ width: 344, height: 800 });
	await page.goto("/");
	const pdf = async () => {
		const response = await page.request.get(
			`/api/export-pdf?name=${encodeURIComponent(doc)}`,
			{ headers: { Referer: `${baseURL}/` } },
		);
		expect(response.ok()).toBe(true);
		return (await response.body())
			.toString("latin1")
			.match(/\/MediaBox\s*\[[^\]]+\]/g);
	};
	const paperBefore = await pdf();
	expect(paperBefore?.length).toBeGreaterThan(0);
	await mcp.call("maket_doc", { action: "meta", doc, responsive: true });
	await expect
		.poll(
			async () =>
				(
					await mcp.callJson<{ responsive?: boolean }>("maket_doc", {
						action: "lookup",
						doc,
					})
				).responsive,
		)
		.toBe(true);
	const link = await mcp.callJson<{ path: string }>("maket_doc", {
		action: "link",
		doc,
	});
	await page.goto(link.path);
	const reader = page.locator("[data-responsive-reading]");
	await expect(reader).toBeVisible();
	await expect(reader.locator("[data-responsive-page]")).toHaveCount(2);
	await expect(reader.locator("[data-reader-zoom]")).toHaveCSS("zoom", "1");
	const body = reader.locator('[data-id="body"]').first();
	await expect(body).toHaveCSS("font-size", "16px");
	await expect
		.poll(() =>
			body.evaluate((el) =>
				getComputedStyle(el).getPropertyValue("--layout").trim(),
			),
		)
		.toBe("narrow");
	const box = await reader.boundingBox();
	if (!box) throw new Error("Missing reader viewport");
	const session = await page.context().newCDPSession(page);
	await swipeTouch(
		page,
		session,
		{ x: box.x + box.width / 2, y: box.y + box.height * 0.7 },
		{ x: box.x + box.width / 2, y: box.y + box.height * 0.25 },
	);
	await expect
		.poll(() => reader.evaluate((el) => el.scrollTop))
		.toBeGreaterThan(0);
	await page.setViewportSize({ width: 1280, height: 900 });
	await expect
		.poll(() =>
			body.evaluate((el) =>
				getComputedStyle(el).getPropertyValue("--layout").trim(),
			),
		)
		.toBe("wide");
	expect(await pdf()).toEqual(paperBefore);
	await mcp.call("maket_doc", {
		action: "export",
		docs: [doc],
		output: "responsive-proof.maket",
	});
	await createDocument(mcp, "Keep bundle import alive");
	await mcp.call("maket_doc", { action: "delete", doc });
	await mcp.call("maket_doc", {
		action: "import",
		input: "responsive-proof.maket",
	});
	expect(
		(
			await mcp.callJson<{ responsive: boolean }>("maket_doc", {
				action: "lookup",
				doc,
			})
		).responsive,
	).toBe(true);
	const restored = await mcp.callJson<{ path: string }>("maket_doc", {
		action: "link",
		doc,
	});
	await page.goto(restored.path);
	await expect(reader).toBeVisible();
	await mcp.call("maket_doc", { action: "meta", doc, responsive: false });
	await expect(page.locator("[data-responsive-reading]")).toHaveCount(0);
	const canvas = page.locator(".page-canvas").first();
	expect(await canvas.evaluate((el) => el.clientWidth)).toBeCloseTo(
		(210 * 96) / 25.4,
		0,
	);
});

test("template opt-in synchronizes existing projections and linked index opens its item and returns", async ({
	page,
	mcp,
}) => {
	await page.setViewportSize({ width: 344, height: 800 });
	await createDocument(mcp, "Fluid index", {
		html: '<style>main{padding:16px;--layout:wide}@container(max-width:600px){main{--layout:narrow}}</style><main data-id="index"><section data-id="items" data-maket-structured-items="item"></section></main>',
	});
	await createDocument(mcp, "Fluid card", {
		html: '<article data-id="card" data-maket-compact-root><button data-id="open" type="button" data-maket-action="open-document">Open {{ state.title }}</button></article>',
	});
	await createDocument(mcp, "Fluid detail", {
		html: '<main data-id="detail" style="padding:16px;font:16px system-ui"><h1 data-id="title">{{ state.title }}</h1><p data-id="body" style="min-height:1500px">Long detail</p></main>',
	});
	await mcp.call("maket_structured_workspace", {
		action: "create",
		workspace: "Fluid workspace",
		data_schema: {
			$defs: {
				item: {
					type: "object",
					properties: { id: { type: "string" }, title: { type: "string" } },
					required: ["id", "title"],
				},
			},
			oneOf: [{ $ref: "#/$defs/item" }],
		},
		representation_schema: {
			collections: {
				items: {
					name: "Items",
					identity: "/id",
					collectionTemplateDocumentId: "Fluid index",
					bindings: {
						item: {
							schemaPath: "/$defs/item",
							compactTemplateDocumentId: "Fluid card",
							detailTemplateDocumentId: "Fluid detail",
						},
					},
				},
			},
		},
	});
	await mcp.call("maket_structured_workspace", {
		action: "add_item",
		workspace: "Fluid workspace",
		collection: "items",
		binding: "item",
		item: "first",
		document_name: "First item",
		data: { id: "first", title: "First item" },
	});
	for (const doc of ["Fluid index", "Fluid detail"])
		await mcp.call("maket_doc", { action: "meta", doc, responsive: true });
	await mcp.callError("maket_doc", {
		action: "meta",
		doc: "Fluid index",
		responsive: true,
		rating: 5,
	});
	await mcp.call("maket_structured_workspace", {
		action: "sync_template",
		workspace: "Fluid workspace",
	});
	const workspace = await mcp.callJson<StructuredWorkspaceView>(
		"maket_structured_workspace",
		{ action: "view", workspace: "Fluid workspace" },
	);
	const index = workspace.collectionDocuments[0];
	if (!index) throw new Error("Missing workspace index");
	expect(
		(
			await mcp.callJson<{ responsive: boolean }>("maket_doc", {
				action: "lookup",
				doc: index.documentName,
			})
		).responsive,
	).toBe(true);
	await mcp.callError("maket_doc", {
		action: "meta",
		doc: index.documentName,
		responsive: true,
	});
	const link = await mcp.callJson<{ path: string }>("maket_doc", {
		action: "link",
		doc: index.documentName,
	});
	await page.goto(link.path);
	await expect(page.locator("[data-responsive-reading]")).toBeVisible();
	await page
		.getByRole("button", { name: "Open First item", exact: true })
		.tap();
	await expect(
		page
			.locator(".page-canvas")
			.getByRole("heading", { name: "First item", exact: true }),
	).toBeVisible();
	await expect(page.locator("[data-responsive-reading]")).toBeVisible();
	await page
		.getByRole("button", { name: "Back to linked document", exact: true })
		.tap();
	await expect(
		page.getByRole("button", { name: "Open First item", exact: true }),
	).toBeVisible();
	await mcp.call("maket_doc", {
		action: "meta",
		doc: "Fluid detail",
		responsive: false,
	});
	await mcp.call("maket_structured_workspace", {
		action: "sync_template",
		workspace: "Fluid workspace",
	});
	await page
		.getByRole("button", { name: "Open First item", exact: true })
		.tap();
	await expect(
		page
			.locator(".page-canvas")
			.getByRole("heading", { name: "First item", exact: true }),
	).toBeVisible();
	await expect(page.locator("[data-responsive-reading]")).toHaveCount(0);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openWorkspace(page);
	const library = await openLibraryView(page, "structured-workspaces");
	await library
		.getByRole("button", { name: "Fluid workspace", exact: true })
		.tap();
	await library.getByRole("button", { name: "Items", exact: true }).tap();
	const indexPane = page.locator("[data-structured-index-pane]");
	await expect
		.poll(() =>
			indexPane
				.locator('[data-id="index"]')
				.evaluate((el) =>
					getComputedStyle(el).getPropertyValue("--layout").trim(),
				),
		)
		.toBe("wide");
	expect(await page.evaluate(() => innerWidth)).toBe(1440);
	await page.setViewportSize({ width: 344, height: 800 });
	await expect
		.poll(() =>
			indexPane
				.locator('[data-id="index"]')
				.evaluate((el) =>
					getComputedStyle(el).getPropertyValue("--layout").trim(),
				),
		)
		.toBe("narrow");
});
