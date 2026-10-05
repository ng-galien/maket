import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.describe("Structured Workspace", () => {
	test("opens an item from its rendered collection action", async ({
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
			html: '<article data-id="card" data-maket-compact-root><h2 data-id="title">{{ state.title }}</h2><button data-id="open" type="button" data-maket-action="open-document">Open item</button></article>',
		});
		await createDocument(mcp, detailTemplate, {
			html: '<main data-id="detail"><h1 data-id="title">{{ state.title }}</h1><p data-id="proof">Detail opened from collection</p></main>',
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
						},
						required: ["kind", "title"],
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
			data: { kind: "task", title: "Ship the release" },
		});

		const library = await openLibraryView(page, "structured-workspaces");
		const workspace = library
			.locator("[data-structured-workspace]")
			.filter({ hasText: workspaceName });
		await expect(workspace).toBeVisible();
		await workspace.locator("button").first().click();

		const collectionDocument = `${workspaceName} — Backlog`;
		await expect(
			page.locator(`[data-doc="${collectionDocument}"]`),
		).toBeVisible();
		await page.getByRole("button", { name: "Open item" }).click();

		const detail = page.locator(`[data-doc="${itemDocument}"]`);
		await expect(detail).toBeVisible();
		await expect(
			detail.getByText("Detail opened from collection"),
		).toBeVisible();
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
