import { gzipSync } from "node:zlib";
import type { Locator } from "@playwright/test";
import { createDocument, expect, openWorkspace, test } from "./workspace-test";

test.describe("Brand guides", () => {
	test("rejects an unread or non-compliant brand composition and renders the compliant one", async ({
		mcp,
		page,
	}) => {
		const docName = "Agent branded proposal";
		const charteName = "Agent cyan brand";
		await mcp.call("maket_charte", {
			action: "set",
			name: charteName,
			description: "Cyan product identity",
			tokens: {
				color: { primary: "#164e63", surface: "#ecfeff" },
				font: { heading: "Inter" },
			},
			voice: { personality: ["clear"], formality: "professional" },
			rules: { titles: "Use concise titles" },
		});
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A4",
			orientation: "portrait",
			charte: charteName,
		});
		await openWorkspace(page);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		const unread = await mcp.callError("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			html: '<h1 data-id="rejected">Rejected brand title</h1>',
		});
		expect(unread).toMatch(/context.token|read.*charte/i);
		await expect(page.getByText("Rejected brand title")).toHaveCount(0);

		const charte = await mcp.callText("maket_charte", {
			action: "view",
			name: charteName,
		});
		const contextToken = charte.match(/context_token:\s*(\S+)/)?.[1];
		expect(contextToken).toBeTruthy();
		const nonCompliant = await mcp.callError("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			context_token: contextToken,
			html: [
				'<main data-id="page" style="width:210mm;height:297mm;padding:20mm">',
				'<h1 data-id="rejected" style="color:#164e63;font-family:Arial">Rejected brand title</h1>',
				"</main>",
			].join(""),
		});
		expect(nonCompliant).toContain("Charte violation");
		await expect(page.getByText("Rejected brand title")).toHaveCount(0);

		await mcp.call("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			context_token: contextToken,
			html: [
				'<main data-id="page" style="width:210mm;height:297mm;padding:20mm;background:var(--charte-color-surface)">',
				'<h1 data-id="brand-title" style="color:var(--charte-color-primary);font-family:var(--charte-font-heading)">Approved brand title</h1>',
				"</main>",
			].join(""),
		});

		const title = page.locator(
			`[data-doc="${docName}"] [data-id="brand-title"]`,
		);
		await expect(title).toHaveText("Approved brand title");
		expect(await title.evaluate((node) => getComputedStyle(node).color)).toBe(
			"rgb(22, 78, 99)",
		);
		const persisted = await mcp.callText("maket_html", {
			action: "get",
			doc: docName,
			page: 1,
		});
		expect(persisted).toContain("var(--charte-color-primary)");
		expect(persisted).not.toContain("Rejected brand title");
	});

	test("applies and edits a charte with server-visible persistence", async ({
		mcp,
		page,
	}) => {
		const docName = "Launch poster";
		const charteName = "Acme launch";
		await createDocument(mcp, docName);
		await mcp.call("maket_charte", {
			action: "set",
			name: charteName,
			description: "Original identity",
			tokens: {
				color: { primary: "#123456", background: "#ffffff" },
				font: { heading: "Inter" },
			},
			voice: { personality: ["clear"], formality: "professional" },
			rules: { titles: "Use short titles" },
		});

		await openWorkspace(page);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});
		await expect(page.locator(`[data-doc="${docName}"]`)).toBeVisible();
		await page.getByRole("button", { name: /^(Brand|Chartes)$/i }).click();
		const panel = page.getByRole("complementary", { name: /Brand|Chartes/i });
		await expect(panel).toBeVisible();
		await panel
			.getByPlaceholder(/Search brand|Rechercher une charte/i)
			.fill("Acme");
		const row = charteRow(panel, charteName);
		await row.getByRole("button", { name: /^(Apply|Appliquer)$/i }).click();

		await expect(panel.getByText(/Applied|Appliquée/i)).toBeVisible();
		const workspaceState = await mcp.callText("maket_workspace", {
			action: "state",
			doc: docName,
		});
		expect(workspaceState).toContain(charteName);

		const activeRow = charteRow(panel, charteName);
		await activeRow.hover();
		await activeRow.getByRole("button", { name: /^(Actions)$/i }).click();
		await page.getByRole("button", { name: /^(Edit|Modifier)$/i }).click();
		const dialog = page.getByRole("dialog", {
			name: /Edit brand|Modifier la charte/i,
		});
		await expect(dialog).toBeVisible();
		await dialog
			.getByRole("textbox", {
				name: /One-line human description|Courte description/i,
			})
			.fill("Identity updated in the workspace");
		await dialog
			.getByRole("button", { name: /Add token|Ajouter un token/i })
			.first()
			.click();
		const colorTokens = dialog
			.getByText(/^(Colors|Couleurs)$/i)
			.locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
		await colorTokens
			.getByPlaceholder(/Token name|Nom du token/i)
			.last()
			.fill("accent");
		await colorTokens
			.getByPlaceholder(/^(Value|Valeur)$/i)
			.last()
			.fill("#ff6600");
		await dialog.getByRole("button", { name: /^(Save|Enregistrer)$/i }).click();
		await expect(dialog).toHaveCount(0);

		const persisted = await mcp.callText("maket_charte", {
			action: "view",
			name: charteName,
		});
		expect(persisted).toContain("Identity updated in the workspace");
		expect(persisted).toContain("--charte-color-accent: #ff6600");
	});

	test("reads and modernizes historical string rules through the real library", async ({
		mcp,
		page,
	}) => {
		const docName = "Historical rules poster";
		const charteName = "Historical rule book";
		const bundle = gzipSync(
			JSON.stringify({
				version: 1,
				kind: "maket-bundle",
				exportedAt: "2026-08-12T00:00:00.000Z",
				documents: [
					{
						id: "historical-rules-doc",
						name: docName,
						canvas: {
							format: "A4",
							orientation: "portrait",
							w: 210,
							h: 297,
							bg: "#fff",
						},
						meta: { charte: charteName },
						pages: [
							{
								name: "P1",
								elements: [],
								html: "<h1>Historical rules</h1>",
							},
						],
						activePage: 0,
						nextId: 1,
					},
				],
				chartes: [
					{
						name: charteName,
						description: "Imported legacy guide",
						tokens: { color: { primary: "#334155" } },
						rules: JSON.stringify({
							titles: "Keep the historical title rule",
							layout: "Keep a generous margin",
							accessibility: "Maintain readable contrast",
						}),
					},
				],
			}),
		);

		await openWorkspace(page);
		await page.getByRole("button", { name: /^documents$/i }).click();
		const documents = page.getByRole("complementary", { name: /^documents$/i });
		await documents.locator('input[type="file"]').setInputFiles({
			name: "historical-rules.maket",
			mimeType: "application/gzip",
			buffer: bundle,
		});
		await expect(documents.getByText(docName, { exact: true })).toBeVisible();
		await page.getByRole("button", { name: /close documents/i }).click();

		await page.getByRole("button", { name: /^(brand|chartes)$/i }).click();
		const panel = page.getByRole("complementary", { name: /brand|chartes/i });
		await panel.getByText(charteName, { exact: true }).click();
		await expect(
			panel.getByText("Keep the historical title rule"),
		).toBeVisible();
		await expect(panel.getByText("Keep a generous margin")).toBeVisible();
		await expect(panel.getByText("Maintain readable contrast")).toBeVisible();

		await panel.getByRole("button", { name: /^(edit|modifier)$/i }).click();
		const dialog = page.getByRole("dialog", {
			name: /edit brand|modifier la charte/i,
		});
		const titleRule = dialog
			.getByText(/^(titles|titres)$/i)
			.locator("xpath=..")
			.locator("textarea");
		await titleRule.fill("Use a modernized title rule");
		await dialog.getByRole("button", { name: /^(save|enregistrer)$/i }).click();

		const persisted = await mcp.callText("maket_charte", {
			action: "view",
			name: charteName,
		});
		expect(persisted).toContain("titles: Use a modernized title rule");
		expect(persisted).toContain("accessibility: Maintain readable contrast");
	});
});

function charteRow(panel: Locator, name: string): Locator {
	return panel
		.getByText(name, { exact: true })
		.locator(
			"xpath=ancestor::div[contains(@class,'relative') and contains(@class,'group')][1]",
		);
}
