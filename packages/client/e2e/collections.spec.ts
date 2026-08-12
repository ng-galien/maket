import type { Locator, Page } from "@playwright/test";
import { expect, openWorkspace, test } from "./workspace-test";

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
		await page.getByRole("button", { name: /^(Collections)$/i }).click();
		const library = page.getByRole("complementary", {
			name: /^(Collections)$/i,
		});
		const card = library
			.getByText(name, { exact: true })
			.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
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
		const sourceDialog = page.getByRole("dialog", {
			name: /Data source|Source de données/i,
		});
		await sourceDialog
			.getByRole("button", {
				name: /Current row render|Rendu ligne courante/i,
			})
			.click();
		await expect(document.locator(".page-canvas")).toHaveCount(1);
		await sourceDialog
			.getByRole("button", {
				name: /Previous row|Ligne précédente/i,
			})
			.click();
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

	test("creates a collection, pastes tabular data and persists the draft", async ({
		mcp,
		page,
	}) => {
		await openWorkspace(page);
		await page.getByRole("button", { name: /^(Collections)$/i }).click();
		const library = page.getByRole("complementary", {
			name: /^(Collections)$/i,
		});
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
		await editor.getByPlaceholder(/Description/i).fill("Launch pipeline");
		await editor.getByPlaceholder(/new_field|nouveau_champ/i).fill("budget");
		await editor
			.getByRole("combobox", { name: /Field type|Type/i })
			.selectOption("number");
		await editor
			.getByRole("button", { name: /Add field|Ajouter un champ/i })
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
	return page
		.getByText(name, { exact: true })
		.locator(
			"xpath=ancestor::div[contains(@class,'fixed') and contains(@class,'right-4')][1]",
		);
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
