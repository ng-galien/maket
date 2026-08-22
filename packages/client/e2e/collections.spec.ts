import type { Locator, Page } from "@playwright/test";
import { expect, openLibraryView, openWorkspace, test } from "./workspace-test";

test.describe("Collection workspace", () => {
	test("requires a completed hold before deleting a persisted collection", async ({
		mcp,
		page,
	}) => {
		const name = "hold_to_delete_clients";
		await mcp.call("maket_collection", {
			action: "create",
			name,
			schema: {
				type: "object",
				properties: { client_name: { type: "string" } },
				required: ["client_name"],
			},
		});
		await openWorkspace(page);
		const library = await openLibraryView(page, "collections");
		const card = library.locator(`[data-collection-row="${name}"]`);
		await expect(card).toBeVisible();
		await card.getByRole("button", { name: /^(Delete|Supprimer)$/i }).click();
		const hold = card.getByRole("button", {
			name: /Hold to delete|Maintenir pour supprimer/i,
		});
		await expect(hold).toBeVisible();

		await pressFor(page, hold, 180);
		await expect(card).toBeVisible();
		const retained = await mcp.callText("maket_collection", {
			action: "view",
			name,
		});
		expect(retained).toContain(`Collection: "${name}"`);

		await pressFor(page, hold, 800);
		await expect(card).toHaveCount(0);
		const missing = await mcp.callError("maket_collection", {
			action: "view",
			name,
		});
		expect(missing).toContain(`Collection not found: "${name}"`);
	});

	test("renders and shares a collection cursor driven by an MCP agent", async ({
		mcp,
		page,
	}) => {
		const docName = "Agent price cards";
		const collectionName = "agent_clients";
		await openWorkspace(page);
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A6",
			orientation: "landscape",
		});
		await mcp.call("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			html: [
				'<main data-id="card" style="width:148mm;height:105mm;padding:12mm">',
				'<h1 data-id="client">{{ client_name }}</h1>',
				'<p data-id="budget">Budget €{{ budget }}</p>',
				"</main>",
			].join(""),
		});
		await mcp.call("maket_collection", {
			action: "create",
			name: collectionName,
			description: "Clients prepared by the agent",
			schema: {
				type: "object",
				properties: {
					client_name: { type: "string", title: "Client" },
					budget: { type: "number", title: "Budget" },
				},
				required: ["client_name", "budget"],
			},
		});
		await mcp.call("maket_collection", {
			action: "add_row",
			name: collectionName,
			row: "acme",
			data: { client_name: "Acme", budget: 1200 },
		});
		await mcp.call("maket_collection", {
			action: "add_row",
			name: collectionName,
			row: "globex",
			data: { client_name: "Globex", budget: 950 },
		});
		await mcp.call("maket_collection", {
			action: "bind",
			name: collectionName,
			doc: docName,
			page: 1,
		});
		await mcp.call("maket_collection", {
			action: "cursor",
			doc: docName,
			page: 1,
			mode: "rendered",
			row: "globex",
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		const document = page.locator(`[data-doc="${docName}"]`);
		await expect(document.getByText("Globex", { exact: true })).toBeVisible();
		await expect(
			document.getByText("Budget €950", { exact: true }),
		).toBeVisible();
		await expect(document.getByText("Acme", { exact: true })).toHaveCount(0);

		await mcp.call("maket_collection", {
			action: "cursor",
			doc: docName,
			page: 1,
			mode: "all",
		});
		await expect(document.locator(".page-canvas")).toHaveCount(2);
		await expect(document.getByText("Acme", { exact: true })).toBeVisible();
		await expect(document.getByText("Globex", { exact: true })).toBeVisible();

		await page
			.getByRole("button", {
				name: /agent_clients · (All rows|Toutes les lignes)/i,
			})
			.click();
		const dataDock = page.locator("[data-collection-dock]");
		await expect(dataDock).toBeVisible();
		await expect(
			page.getByRole("dialog", { name: /Data source|Source de données/i }),
		).toHaveCount(0);
		await dataDock
			.getByRole("button", {
				name: /Current row render|Rendu ligne courante/i,
			})
			.click();
		await expect(document.locator(".page-canvas")).toHaveCount(1);
		await dataDock.getByText("Acme", { exact: true }).click();
		await expect(document.getByText("Acme", { exact: true })).toBeVisible();
		await expect(document.getByText("Globex", { exact: true })).toHaveCount(0);

		const cursor = await mcp.callText("maket_collection", {
			action: "cursor",
			doc: docName,
			page: 1,
		});
		expect(cursor).toContain("mode rendered");
		expect(cursor).toContain("row 1/2 (acme");
	});

	test("opens linked data with a document preview and autonomous data without one", async ({
		mcp,
		page,
	}) => {
		const docName = "Collection shell document";
		const linkedName = "linked_shell_data";
		const autonomousName = "autonomous_shell_data";
		await openWorkspace(page);
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A4",
			orientation: "portrait",
		});
		await mcp.call("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			html: '<main data-id="page"><h1 data-id="title">{{ label }}</h1></main>',
		});
		for (const name of [linkedName, autonomousName]) {
			await mcp.call("maket_collection", {
				action: "create",
				name,
				schema: {
					type: "object",
					properties: { label: { type: "string" } },
					required: ["label"],
				},
			});
		}
		await mcp.call("maket_collection", {
			action: "add_row",
			name: linkedName,
			row: "linked-row",
			data: { label: "Linked" },
		});
		await mcp.call("maket_collection", {
			action: "bind",
			name: linkedName,
			doc: docName,
			page: 1,
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});
		await expect(page.locator(`[data-doc="${docName}"]`)).toBeVisible();
		const library = await openLibraryView(page, "collections");

		await library.getByText(linkedName, { exact: true }).click();
		const dock = page.locator("[data-collection-dock]");
		await expect(dock).toHaveAttribute(
			"data-collection-layout",
			"expanded-linked",
		);
		await expect(page.locator("[data-document-preview]")).toHaveAttribute(
			"data-document-preview",
			"true",
		);
		await page
			.getByRole("button", {
				name: /Active document · return to split|Document actif · revenir au partage/i,
			})
			.click();
		await expect(dock).toHaveAttribute("data-collection-layout", "split");

		await library.getByText(autonomousName, { exact: true }).click();
		await expect(dock).toHaveAttribute(
			"data-collection-layout",
			"expanded-data",
		);
		await expect(page.locator("[data-document-preview]")).toHaveCount(0);

		await library
			.getByRole("button", {
				name: new RegExp(`^(Open|Ouvrir) ${docName}$`, "i"),
			})
			.click();
		await expect(dock).toHaveAttribute("data-collection-layout", "split");
		await expect(dock.getByText(linkedName, { exact: true })).toBeVisible();
		await expect(page.locator(`[data-doc="${docName}"]`)).toBeVisible();
	});

	test("creates a collection, pastes tabular data and persists the draft", async ({
		mcp,
		page,
	}) => {
		await openWorkspace(page);
		const library = await openLibraryView(page, "collections");
		await expect(library).toBeVisible();
		await library
			.getByRole("button", { name: /New collection|Nouvelle collection/i })
			.last()
			.click();
		await library
			.getByPlaceholder(/collection_name|nom_collection/i)
			.fill("launch_metrics");
		await library
			.getByRole("button", { name: /New collection|Nouvelle collection/i })
			.last()
			.click();

		const editor = collectionEditor(page, "launch_metrics");
		await expect(editor).toBeVisible();
		const emptyCollection = await mcp.callText("maket_collection", {
			action: "view",
			name: "launch_metrics",
		});
		expect(emptyCollection).not.toContain("client_name");
		await editor.getByPlaceholder(/Description/i).fill("Launch pipeline");
		await editor
			.getByPlaceholder(/new_field|nouveau_champ/i)
			.fill("client_name");
		await editor
			.getByRole("button", { name: /Add field|Ajouter un champ/i })
			.click();
		await editor.getByPlaceholder(/new_field|nouveau_champ/i).fill("budget");
		await editor
			.getByRole("combobox", { name: /Field type|Type/i })
			.selectOption("number");
		await editor
			.getByRole("button", { name: /Add field|Ajouter un champ/i })
			.click();
		await editor
			.getByRole("button", { name: /Add row|Ajouter une ligne/i })
			.click();

		const firstCell = editor
			.locator("tbody input:not([type=checkbox])")
			.first();
		await pasteTable(firstCell, "Acme\t1200\nGlobex\t950");
		await expect(editor.getByRole("row")).toHaveCount(3);
		await expect(editor.locator('input[value="Acme"]')).toBeVisible();
		await expect(editor.locator('input[value="1200"]')).toBeVisible();
		await expect(editor.locator('input[value="Globex"]')).toBeVisible();
		await expect(editor.locator('input[value="950"]')).toBeVisible();

		const save = editor.getByRole("button", { name: /^(Save|Enregistrer)$/i });
		await expect(save).toBeDisabled();
		const budgets = editor.locator('tbody input[type="number"]');
		await budgets.nth(0).fill("");
		await budgets.nth(0).fill("1200");
		await budgets.nth(1).fill("");
		await budgets.nth(1).fill("950");
		await expect(save).toBeEnabled();
		await save.click();
		await expect(save).toHaveCount(0);

		const persisted = await mcp.callText("maket_collection", {
			action: "view",
			name: "launch_metrics",
		});
		expect(persisted).toContain("Launch pipeline");
		expect(persisted).toContain('"client_name":"Acme"');
		expect(persisted).toContain('"budget":1200');
		expect(persisted).toContain('"client_name":"Globex"');
	});
});

function collectionEditor(page: Page, name: string): Locator {
	return page.locator("[data-collection-dock]", { hasText: name });
}

async function pasteTable(locator: Locator, text: string): Promise<void> {
	await locator.evaluate((element, pastedText) => {
		const clipboardData = new DataTransfer();
		clipboardData.setData("text/plain", pastedText);
		element.dispatchEvent(
			new ClipboardEvent("paste", {
				bubbles: true,
				cancelable: true,
				clipboardData,
			}),
		);
	}, text);
}

async function pressFor(
	page: Page,
	button: Locator,
	durationMs: number,
): Promise<void> {
	const box = await button.boundingBox();
	if (!box) throw new Error("Hold button has no visible bounds");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(durationMs);
	await page.mouse.up();
}
