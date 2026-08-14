import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { createDocument, expect, openWorkspace, test } from "./workspace-test";

const HISTORICAL_V1_FIXTURE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../server/src/routes/fixtures/historical-v1.maket.b64",
);

test.describe("Document library", () => {
	test("reflects an agent's page and HTML workflow live in the browser", async ({
		mcp,
		page,
	}) => {
		const docName = "Agent-authored proposal";
		await openWorkspace(page);

		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A4",
			orientation: "portrait",
			category: "clients/acme",
		});
		await mcp.call("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			html: [
				'<main data-id="cover" style="width:210mm;height:297mm;padding:20mm">',
				'<h1 data-id="title">Acme proposal draft</h1>',
				'<p data-id="summary">Prepared by the agent</p>',
				"</main>",
			].join(""),
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		const document = page.locator(`[data-doc="${docName}"]`);
		await expect(document.getByText("Acme proposal draft")).toBeVisible();
		await mcp.call("maket_page", {
			action: "rename",
			doc: docName,
			page: 1,
			name: "Cover",
		});
		await mcp.call("maket_page", {
			action: "add",
			doc: docName,
			name: "Details",
			html: [
				'<main data-id="details" style="width:210mm;height:297mm;padding:20mm">',
				'<h2 data-id="details-title">Delivery plan</h2>',
				'<p data-id="details-copy">Initial milestones</p>',
				"</main>",
			].join(""),
		});
		await expect(document.locator(".page-canvas")).toHaveCount(2);
		await expect(document.getByText("Delivery plan")).toBeVisible();

		await mcp.call("maket_page", {
			action: "reorder",
			doc: docName,
			from: 2,
			to: 1,
		});
		await expect(
			document.locator('[data-page="0"] [data-id="details-title"]'),
		).toHaveText("Delivery plan");
		await mcp.call("maket_html", {
			action: "patch",
			doc: docName,
			page: 1,
			ops: [
				{ id: "details-title", content: "Delivery plan approved" },
				{
					id: "details-copy",
					content: "Discovery, design and production",
				},
			],
		});
		await expect(document.getByText("Delivery plan approved")).toBeVisible();
		await expect(
			document.getByText("Discovery, design and production"),
		).toBeVisible();

		const pages = await mcp.callText("maket_page", {
			action: "list",
			doc: docName,
		});
		expect(pages).toMatch(/1\. Details/);
		expect(pages).toMatch(/2\. Cover/);
		const persisted = await mcp.callText("maket_html", {
			action: "get",
			doc: docName,
			page: 1,
		});
		expect(persisted).toContain("Delivery plan approved");
	});

	for (const workspaceView of ["canvas", "reader"] as const) {
		test(`atomically renames an annotated open document in ${workspaceView} mode`, async ({
			context,
			mcp,
			page,
		}) => {
			const oldName = "Agent proposal draft";
			const newName = "Agent proposal final";
			const otherName = "Unrelated document";
			const noteText = "Review the proposal before delivery";
			await openWorkspace(page);
			await createDocument(mcp, oldName);
			await mcp.call("maket_page", {
				action: "add",
				doc: oldName,
				name: "Delivery review",
				html: '<main data-id="review-page"><h2 data-id="review-heading">Delivery review</h2></main>',
			});
			await createDocument(mcp, otherName);

			const oldDocument = page.locator(`[data-doc="${oldName}"]`);
			await expect(oldDocument).toBeVisible();
			await oldDocument.locator('[data-page-view="1"]').click();
			await expect(oldDocument.locator('[data-page-view="1"]')).toHaveAttribute(
				"data-active-page",
				"true",
			);
			const messagesButton = page.getByRole("button", {
				name: /^(exchanges|échanges)$/i,
			});
			await messagesButton.click();
			await page
				.getByPlaceholder(/Note sur le document|Note about the document/i)
				.fill(noteText);
			await page.keyboard.press("Enter");
			await expect(
				oldDocument.locator("[data-annotation-page-marker]"),
			).toBeVisible();
			await messagesButton.click();

			const secondPage = await context.newPage();
			await openWorkspace(secondPage);
			const secondOtherDocument = secondPage.locator(
				`[data-doc="${otherName}"]`,
			);
			await expect(secondOtherDocument).toBeVisible();
			await secondOtherDocument.click();
			await expect(
				secondOtherDocument.locator('[data-page-view="0"]'),
			).toHaveAttribute("data-active-page", "true");

			if (workspaceView === "reader") {
				await page
					.getByRole("button", { name: /Reading view|Vue lecture/i })
					.click();
				await secondPage
					.getByRole("button", { name: /Reading view|Vue lecture/i })
					.click();
				await expect(
					page.getByRole("button", { name: /^(Document)$/i }),
				).toContainText(oldName);
				await expect(
					secondPage.getByRole("button", { name: /^(Document)$/i }),
				).toContainText(otherName);
				await expect(
					page
						.getByRole("navigation", {
							name: /Reader navigation|Navigation du lecteur/i,
						})
						.getByRole("status"),
				).toHaveText(/2\/2/);
			}

			await mcp.call("maket_doc", {
				action: "rename",
				doc: oldName,
				name: newName,
			});

			if (workspaceView === "reader") {
				await expect(
					page.getByRole("button", { name: /^(Document)$/i }),
				).toContainText(newName);
				await expect(page.locator(`[data-doc="${newName}"]`)).toHaveCount(1);
				await expect(page.locator(`[data-doc="${oldName}"]`)).toHaveCount(0);
				await expect(
					page
						.getByRole("navigation", {
							name: /Reader navigation|Navigation du lecteur/i,
						})
						.getByRole("status"),
				).toHaveText(/2\/2/);
				await expect(
					secondPage.getByRole("button", { name: /^(Document)$/i }),
				).toContainText(otherName);
				await expect(secondPage.locator(`[data-doc="${newName}"]`)).toHaveCount(
					0,
				);
				await page
					.getByRole("button", { name: /Canvas view|Vue canevas/i })
					.click();
				await secondPage
					.getByRole("button", { name: /Canvas view|Vue canevas/i })
					.click();
			}

			for (const browserPage of [page, secondPage]) {
				await expect(
					browserPage.locator(`[data-doc="${newName}"]`),
				).toHaveCount(1);
				await expect(
					browserPage.locator(`[data-doc="${oldName}"]`),
				).toHaveCount(0);
			}
			await expect(
				page.locator(
					`[data-doc="${newName}"] [data-page-view="1"][data-active-page="true"]`,
				),
			).toBeVisible();
			await expect(
				secondPage.locator(
					`[data-doc="${otherName}"] [data-page-view="0"][data-active-page="true"]`,
				),
			).toBeVisible();
			await expect(
				page.locator(`[data-doc="${newName}"] [data-annotation-page-marker]`),
			).toBeVisible();
			await expect(
				secondPage.locator(
					`[data-doc="${newName}"] [data-annotation-page-marker]`,
				),
			).toBeVisible();

			const panel = await openDocuments(page);
			await expect(panel.getByText(newName, { exact: true })).toHaveCount(1);
			await expect(panel.getByText(oldName, { exact: true })).toHaveCount(0);
			await page
				.getByRole("button", {
					name: /Close Documents|Fermer Documents/i,
				})
				.click();
			await messagesButton.click();
			await expect(page.getByText(noteText, { exact: true })).toHaveCount(1);

			const messages = await mcp.callJson<
				Array<{ id: string; docName?: string; text?: string }>
			>("maket_workspace", { action: "list_messages" });
			const annotation = messages.find((message) => message.text === noteText);
			expect(annotation).toMatchObject({ docName: newName, text: noteText });
			if (!annotation) throw new Error("Renamed annotation was not returned");
			await mcp.call("maket_workspace", {
				action: "ack_messages",
				ids: [annotation.id],
			});
			await expect(messagesButton.locator("span")).toHaveCount(0);
			await expect(
				secondPage.locator(
					`[data-doc="${newName}"] [data-annotation-page-marker]`,
				),
			).toHaveCount(0);
		});
	}

	test("renames, duplicates and bulk-organises documents through the UI", async ({
		mcp,
		page,
	}) => {
		await createDocument(mcp, "Acme proposal", { category: "clients/acme" });
		await createDocument(mcp, "Acme invoice", { category: "clients/acme" });
		await createDocument(mcp, "Internal brief", { category: "internal" });

		await openWorkspace(page);
		const panel = await openDocuments(page);
		const search = panel.getByPlaceholder(/Search|Rechercher/i);
		await search.fill("proposal");
		await expect(docRow(panel, "Acme proposal")).toBeVisible();
		await expect(docRow(panel, "Acme invoice")).toHaveCount(0);

		await openDocumentMenu(docRow(panel, "Acme proposal"));
		await page.getByRole("button", { name: /^(Rename|Renommer)$/i }).click();
		const rename = panel.getByPlaceholder(/New name|Nouveau nom/i);
		await rename.fill("Acme launch proposal");
		await rename.press("Enter");
		await expect(docRow(panel, "Acme launch proposal")).toBeVisible();

		await search.fill("");
		await openDocumentMenu(docRow(panel, "Acme launch proposal"));
		await page
			.getByRole("button", { name: /^(Duplicate|Dupliquer)$/i })
			.click();
		const duplicate = panel.getByPlaceholder(/Copy name|Nom de la copie/i);
		await duplicate.fill("Acme launch proposal v2");
		await duplicate.press("Enter");
		await expect(docRow(panel, "Acme launch proposal v2")).toBeVisible();

		await docButton(panel, "Acme launch proposal").click({
			modifiers: ["Meta"],
		});
		await docButton(panel, "Acme invoice").click({ modifiers: ["Meta"] });
		await expect(panel.getByText(/2 (selected|sélectionné)/i)).toBeVisible();
		await panel
			.getByRole("button", { name: /Move to category|Changer de catégorie/i })
			.click();
		await page
			.getByRole("button", { name: /New category|Nouvelle catégorie/i })
			.click();
		const category = page.getByPlaceholder(
			/Category path|Chemin de catégorie/i,
		);
		await category.fill("clients/launch");
		await category.press("Enter");

		await search.fill("@clients/launch");
		await search.press("Enter");
		await expect(docRow(panel, "Acme launch proposal")).toBeVisible();
		await expect(docRow(panel, "Acme invoice")).toBeVisible();
		await expect(docRow(panel, "Internal brief")).toHaveCount(0);

		const list = await mcp.callText("maket_doc", { action: "list" });
		expect(list).toContain("Acme launch proposal");
		expect(list).toContain("Acme launch proposal v2");
		expect(list).toContain("launch (2)");
	});

	test("exports a bundle from the library and imports it back", async ({
		mcp,
		page,
	}) => {
		const docName = "Portable proposal";
		await createDocument(mcp, docName, {
			category: "clients/portable",
			html: '<main data-id="page"><h1 data-id="title">Portable content</h1></main>',
		});
		await createDocument(mcp, "Keep workspace alive");

		await openWorkspace(page);
		const panel = await openDocuments(page);
		await openDocumentMenu(docRow(panel, docName));
		const downloadPromise = page.waitForEvent("download");
		await page
			.getByRole("button", { name: /Export \(\.maket\)|Exporter \(\.maket\)/i })
			.click();
		const download = await downloadPromise;
		const bundlePath = await download.path();
		expect(bundlePath).not.toBeNull();

		await mcp.call("maket_doc", { action: "delete", doc: docName });
		await page.reload();
		await openWorkspace(page);
		const reloadedPanel = await openDocuments(page);
		await expect(docRow(reloadedPanel, docName)).toHaveCount(0);
		await reloadedPanel
			.locator('input[type="file"]')
			.setInputFiles(bundlePath as string);
		await expect(docRow(reloadedPanel, docName)).toBeVisible();

		const html = await mcp.callText("maket_html", {
			action: "get",
			doc: docName,
			page: 1,
		});
		expect(html).toContain("Portable content");
	});

	test("imports a historical v1 bundle through the document library", async ({
		mcp,
		page,
	}) => {
		await createDocument(mcp, "Keep legacy import workspace alive");
		await openWorkspace(page);
		const panel = await openDocuments(page);
		const encoded = await readFile(HISTORICAL_V1_FIXTURE, "utf8");
		await panel.locator('input[type="file"]').setInputFiles({
			name: "historical-v1.maket",
			mimeType: "application/gzip",
			buffer: Buffer.from(encoded.trim(), "base64"),
		});

		const legacyRow = docRow(panel, "legacy-poster");
		await expect(legacyRow).toBeVisible();
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: "legacy-poster",
			page: 1,
		});
		await expect(page.locator('[data-doc="legacy-poster"]')).toBeVisible();
		const html = await mcp.callText("maket_html", {
			action: "get",
			doc: "legacy-poster",
			page: 1,
		});
		expect(html).toContain("<h1>Legacy</h1>");
		const charte = await mcp.callText("maket_charte", {
			action: "view",
			name: "legacy-brand",
		});
		expect(charte).toContain("#112233");
		const messages = await mcp.callText("maket_workspace", {
			action: "list_messages",
		});
		expect(messages).toBe("No pending messages");
	});
});

async function openDocuments(page: Page): Promise<Locator> {
	await page.getByRole("button", { name: /^(Documents)$/i }).click();
	const panel = page.getByRole("complementary", { name: /^(Documents)$/i });
	await expect(panel).toBeVisible();
	return panel;
}

function docRow(panel: Locator, name: string): Locator {
	return panel
		.getByText(name, { exact: true })
		.locator(
			"xpath=ancestor::div[contains(@class,'relative') and contains(@class,'group')][1]",
		);
}

function docButton(panel: Locator, name: string): Locator {
	return docRow(panel, name).locator("button").first();
}

async function openDocumentMenu(row: Locator): Promise<void> {
	await row.hover();
	await row.getByRole("button", { name: /^(Actions)$/i }).click();
}
