import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import {
	closeLibrary,
	createDocument,
	expect,
	libraryBadge,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

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
				const readerNavigation = page.getByRole("navigation", {
					name: /Reader navigation|Navigation du lecteur/i,
				});
				const readerStatus = readerNavigation.getByRole("status");
				const previousPage = readerNavigation.getByRole("button", {
					name: /^(Previous page|Page précédente)/i,
				});
				const nextPage = readerNavigation.getByRole("button", {
					name: /^(Next page|Page suivante)/i,
				});
				await expect(readerStatus).toHaveText(/2\/2/);
				await expect(previousPage).toBeVisible();
				await expect(previousPage).toBeEnabled();
				await expect(previousPage).toHaveCSS("opacity", "1");
				await expect(nextPage).toBeVisible();
				await expect(nextPage).toBeDisabled();
				await expect(nextPage).toHaveCSS("opacity", "0.25");

				await page.keyboard.press("ArrowRight");
				await expect(readerStatus).toHaveText(/2\/2/);
				await expect(nextPage).toBeDisabled();
				await page.keyboard.press("ArrowUp");
				await expect(readerStatus).toHaveText(/1\/2/);
				await expect(previousPage).toBeDisabled();
				await expect(previousPage).toHaveCSS("opacity", "0.25");
				await expect(nextPage).toBeEnabled();
				await expect(nextPage).toHaveCSS("opacity", "1");
				await page.keyboard.press("ArrowUp");
				await expect(readerStatus).toHaveText(/1\/2/);
				await expect(previousPage).toBeDisabled();
				await page.keyboard.press("ArrowRight");
				await expect(readerStatus).toHaveText(/2\/2/);
				await page.keyboard.press("ArrowLeft");
				await expect(readerStatus).toHaveText(/1\/2/);
				await page.keyboard.press("ArrowDown");
				await expect(readerStatus).toHaveText(/2\/2/);
				await expect(nextPage).toBeDisabled();
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
					.getByRole("button", {
						name: /Close reader|Fermer la vue lecture/i,
					})
					.click();
				await secondPage
					.getByRole("button", {
						name: /Close reader|Fermer la vue lecture/i,
					})
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
			await closeLibrary(page);
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
			await expect(libraryBadge(messagesButton)).toHaveCount(0);
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
		await page.getByRole("menuitem", { name: /^(Rename|Renommer)$/i }).click();
		const rename = panel.getByPlaceholder(/New name|Nouveau nom/i);
		await rename.fill("Acme launch proposal");
		await rename.press("Enter");
		await expect(docRow(panel, "Acme launch proposal")).toBeVisible();

		await search.fill("");
		await openDocumentMenu(docRow(panel, "Acme launch proposal"));
		await page
			.getByRole("menuitem", { name: /^(Duplicate|Dupliquer)$/i })
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

	test("runs the remaining document row menu actions through the UI", async ({
		baseURL,
		context,
		mcp,
		page,
	}) => {
		if (!baseURL) throw new Error("Playwright baseURL is required");
		const docName = "Menu action proposal";
		await createDocument(mcp, docName, { category: "clients/menu" });
		await createDocument(mcp, "Keep delete available", {
			category: "clients/menu",
		});
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: new URL(baseURL).origin,
		});

		await openWorkspace(page);
		const panel = await openDocuments(page);
		const row = () => docRow(panel, docName);

		await openDocumentMenu(row());
		await page
			.getByRole("menuitem", { name: /^(Copy name|Copier le nom)$/i })
			.click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(`clients/menu/${docName}`);

		await openDocumentMenu(row());
		await page.getByRole("menuitem", { name: /^(Move…|Déplacer…)$/i }).click();
		const moveDialog = page.getByRole("dialog", {
			name: /Move “Menu action proposal”|Déplacer « Menu action proposal »/i,
		});
		const category = moveDialog.getByRole("combobox", {
			name: /Search or create a category|Rechercher ou créer une catégorie/i,
		});
		await category.fill("clients/moved");
		await category.press("Enter");
		await moveDialog
			.getByRole("button", {
				name: /Move to clients\/moved|Déplacer vers clients\/moved/i,
			})
			.click();
		await expect(
			panel
				.locator('[data-category-documents="clients/moved"]')
				.getByText(docName, { exact: true }),
		).toBeVisible();

		await openDocumentMenu(row());
		await page
			.getByRole("menuitem", {
				name: /^(Lock \(MCP read-only\)|Verrouiller \(MCP en lecture seule\))$/i,
			})
			.click();
		await expect(
			row().getByLabel(/Locked document|Document verrouillé/i),
		).toBeVisible();

		await openDocumentMenu(row());
		await expect(
			page.getByRole("menuitem", { name: /^(Rename|Renommer)$/i }),
		).toBeDisabled();
		await expect(
			page.getByRole("menuitem", { name: /^(Move…|Déplacer…)$/i }),
		).toBeDisabled();
		await expect(
			page.getByRole("menuitem", { name: /^(Delete|Supprimer)$/i }),
		).toBeDisabled();
		await page
			.getByRole("menuitem", { name: /^(Unlock|Déverrouiller)$/i })
			.click();
		await expect(
			row().getByLabel(/Locked document|Document verrouillé/i),
		).toHaveCount(0);

		await openDocumentMenu(row());
		const deleteAction = page.getByRole("menuitem", {
			name: /^(Delete|Supprimer)$/i,
		});
		await expect(deleteAction).toBeEnabled();
		await deleteAction.click();
		const hold = row().getByRole("button", {
			name: /Hold to delete|Maintenir pour supprimer/i,
		});
		await expect(hold).toBeVisible();
		await pressFor(page, hold, 800);
		await expect(row()).toHaveCount(0);

		const list = await mcp.callText("maket_doc", { action: "list" });
		expect(list).not.toContain(docName);
	});

	test("keeps nested categories aligned at the minimum panel width", async ({
		mcp,
		page,
	}) => {
		await createDocument(mcp, "Client index", { category: "clients" });
		await createDocument(mcp, "Acme overview", { category: "clients/acme" });
		await createDocument(mcp, "Acme campaign brief", {
			category: "clients/acme/campaigns",
		});
		await createDocument(mcp, "Acme campaign copy", {
			category: "clients/acme/campaigns",
		});
		await createDocument(mcp, "Acme report", {
			category: "clients/acme/reports",
		});
		await createDocument(mcp, "Globex campaign", {
			category: "clients/globex/campaigns",
		});

		await openWorkspace(page);
		const panel = await openDocuments(page);
		const resizeHandle = panel.getByRole("separator", {
			name: /Resize library panel|Redimensionner le panneau de bibliothèque/i,
		});
		await resizeHandle.focus();
		for (let index = 0; index < 10; index += 1) {
			await resizeHandle.press("ArrowLeft");
		}
		await expect(resizeHandle).toHaveAttribute("aria-valuenow", "320");

		const category = (path: string) =>
			panel.locator(`[data-category-path="${path}"]`);
		const categoryPart = (path: string, part: string) =>
			category(path).locator(`[data-category-${part}]`);
		const clients = category("clients");
		await clients.click();
		await expect(categoryPart("clients", "chevron")).toHaveCSS(
			"color",
			"rgb(24, 24, 27)",
		);
		await expect(category("clients/acme")).toHaveCount(0);
		await clients.click();
		await expect(categoryPart("clients", "chevron")).toHaveCSS(
			"color",
			"rgb(16, 185, 129)",
		);
		await expect(category("clients/acme")).toBeVisible();
		const acme = category("clients/acme");
		await acme.click();
		await expect(category("clients/acme/campaigns")).toHaveCount(0);
		await acme.click();
		await expect(category("clients/acme/campaigns")).toBeVisible();

		const paths = [
			"clients",
			"clients/acme",
			"clients/globex",
			"clients/acme/campaigns",
			"clients/acme/reports",
			"clients/globex/campaigns",
		];
		const boxes = new Map<
			string,
			{
				label: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
				count: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
			}
		>();
		for (const path of paths) {
			const label = await categoryPart(path, "label").boundingBox();
			const count = await categoryPart(path, "count").boundingBox();
			expect(label, `${path} label should be rendered`).not.toBeNull();
			expect(count, `${path} count should be rendered`).not.toBeNull();
			if (label && count) boxes.set(path, { label, count });
		}

		const x = (path: string) => boxes.get(path)?.label.x ?? 0;
		expect(x("clients/acme") - x("clients")).toBeCloseTo(16, 0);
		expect(x("clients/acme/campaigns") - x("clients/acme")).toBeCloseTo(16, 0);
		expect(x("clients/globex/campaigns") - x("clients/globex")).toBeCloseTo(
			16,
			0,
		);
		expect(x("clients/acme")).toBeCloseTo(x("clients/globex"), 0);
		expect(x("clients/acme/campaigns")).toBeCloseTo(
			x("clients/acme/reports"),
			0,
		);

		for (const [docName, owner] of [
			["Client index", "clients"],
			["Acme overview", "clients/acme"],
			["Acme campaign brief", "clients/acme/campaigns"],
			["Acme report", "clients/acme/reports"],
			["Globex campaign", "clients/globex/campaigns"],
		] as const) {
			const title = await panel
				.getByText(docName, { exact: true })
				.boundingBox();
			expect(title, `${docName} should be rendered`).not.toBeNull();
			if (title) expect(title.x).toBeCloseTo(x(owner), 0);
		}

		for (const { label, count } of boxes.values()) {
			const gap = count.x - (label.x + label.width);
			expect(gap).toBeGreaterThanOrEqual(7);
			expect(gap).toBeLessThanOrEqual(9);
		}
		await expect(categoryPart("clients/acme/reports", "label")).toHaveCSS(
			"color",
			"rgb(24, 24, 27)",
		);
		await expect(panel.getByText("Acme report", { exact: true })).toHaveCSS(
			"color",
			"rgb(113, 113, 122)",
		);
		await expect(
			category("clients").locator("[data-category-total]"),
		).toHaveText("6");
		await expect(
			category("clients").locator("[data-category-open-count]"),
		).toHaveCount(0);
		await expect(categoryPart("clients", "count")).toHaveText("6");
		await expect(
			category("clients").locator("[data-category-marker]"),
		).toHaveCount(0);
		const chevronBackground = await categoryPart("clients", "chevron").evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		);
		expect(chevronBackground).toBe("rgba(0, 0, 0, 0)");
		const countRadius = await categoryPart("clients", "count").evaluate(
			(element) => Number.parseFloat(getComputedStyle(element).borderRadius),
		);
		expect(countRadius).toBe(4);

		for (const path of ["clients", "clients/acme", "clients/globex"]) {
			const chevron = await categoryPart(path, "chevron").boundingBox();
			const guide = await panel
				.locator(`[data-category-guide="${path}"]`)
				.boundingBox();
			expect(chevron, `${path} chevron should be rendered`).not.toBeNull();
			expect(guide, `${path} guide should be rendered`).not.toBeNull();
			if (chevron && guide) {
				expect(guide.x).toBeCloseTo(chevron.x + chevron.width / 2, 0);
			}
		}

		const documentScroll = panel.locator("[data-documents-scroll]");
		const panelSize = await documentScroll.evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
		}));
		expect(panelSize.scrollWidth).toBeLessThanOrEqual(panelSize.clientWidth);
	});

	test("turns breadcrumb levels into cumulative removable category filters", async ({
		mcp,
		page,
	}) => {
		const docName = "Breadcrumb filters";
		await openWorkspace(page);
		await createDocument(mcp, docName, {
			category: "clients/acme/campaigns",
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		await page
			.getByRole("button", {
				name: /Filter documents by category clients$|Filtrer les documents par catégorie clients$/i,
			})
			.click();
		await page
			.getByRole("button", {
				name: /Filter documents by category clients\/acme$|Filtrer les documents par catégorie clients\/acme$/i,
			})
			.click();

		const search = page.getByRole("combobox", {
			name: /@category|@catégorie/i,
		});
		await expect(search).toHaveValue("@clients @clients/acme ");
		await expect(
			page.getByRole("button", { name: "@clients", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "@clients/acme", exact: true }),
		).toBeVisible();

		await page.getByRole("button", { name: "@clients", exact: true }).click();
		await expect(search).toHaveValue("@clients/acme ");
		await expect(page.locator(`[data-doc-row="${docName}"]`)).toBeVisible();
	});

	test("centers an open document without a heavy row treatment", async ({
		mcp,
		page,
	}) => {
		const alpha = "Open proposal alpha";
		const beta = "Open proposal beta";
		await openWorkspace(page);
		await createDocument(mcp, alpha, { category: "clients/open" });
		await createDocument(mcp, beta, { category: "clients/open" });
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: alpha,
			page: 1,
		});
		await expect(page.locator(`[data-doc="${alpha}"]`)).toBeVisible();
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: beta,
			page: 1,
		});
		await expect(page.locator(`[data-doc="${beta}"]`)).toBeVisible();

		const panel = await openDocuments(page);
		const alphaRow = docRow(panel, alpha);
		const betaRow = docRow(panel, beta);
		await expect(
			panel.locator(
				'[data-category-path="clients/open"] [data-category-count]',
			),
		).toHaveText("2/2");
		await expect(docButton(panel, alpha)).toHaveCSS(
			"background-color",
			"rgba(0, 0, 0, 0)",
		);
		await expect(alphaRow.getByText(alpha, { exact: true })).toHaveCSS(
			"color",
			"rgb(16, 185, 129)",
		);
		await expect(alphaRow.getByText("✓", { exact: true })).toHaveCount(0);
		await expect(betaRow.getByText("✓", { exact: true })).toHaveCount(0);
		const viewAlpha = alphaRow.getByRole("button", {
			name: `View ${alpha}`,
		});
		await expect(viewAlpha).not.toHaveAttribute("aria-pressed");
		await expect(
			betaRow.getByRole("button", { name: `View ${beta}` }),
		).not.toHaveAttribute("aria-pressed");
		await expect(alphaRow.getByText("A4", { exact: true })).toHaveCount(0);
		const infoId = await docButton(panel, alpha).getAttribute(
			"aria-describedby",
		);
		expect(infoId).not.toBeNull();
		const info = page.locator(`[id="${infoId}"]`);
		await expect(info).toContainText("A4 · 1p");
		await expect(info).toHaveCSS("opacity", "0");
		await docButton(panel, alpha).hover();
		await expect(info).toHaveCSS("opacity", "1");
		await expect(info).toHaveCSS("background-color", "rgb(255, 255, 255)");
		await expect(info).toHaveCSS("color", "rgb(24, 24, 27)");
		const rowButtonBox = await docButton(panel, alpha).boundingBox();
		const infoBox = await info.boundingBox();
		expect(rowButtonBox).not.toBeNull();
		expect(infoBox).not.toBeNull();
		if (rowButtonBox && infoBox) {
			const pointerX = rowButtonBox.x + rowButtonBox.width / 2;
			const pointerY = rowButtonBox.y + rowButtonBox.height / 2;
			expect(pointerX - infoBox.x).toBeCloseTo(18, 0);
			expect(pointerY - (infoBox.y + infoBox.height)).toBeCloseTo(8, 0);
		}
		await docButton(panel, alpha).click({ modifiers: ["Meta"] });
		await expect(info).toHaveCSS("opacity", "0");
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(docButton(panel, alpha)).toBeFocused();
		await expect(info).toHaveCSS("opacity", "1");
		await page.keyboard.press("Tab");
		await expect(info).toHaveCSS("opacity", "0");
		const titleBox = await alphaRow
			.getByText(alpha, { exact: true })
			.boundingBox();
		const menuBox = await alphaRow
			.getByRole("button", { name: "Actions" })
			.boundingBox();
		const viewBox = await viewAlpha.boundingBox();
		const viewIconBox = await viewAlpha.locator("svg").boundingBox();
		expect(titleBox).not.toBeNull();
		expect(menuBox).not.toBeNull();
		expect(viewBox).not.toBeNull();
		expect(viewIconBox).not.toBeNull();
		if (titleBox && menuBox && viewBox && viewIconBox) {
			expect(titleBox.x + titleBox.width).toBeLessThan(menuBox.x);
			expect(menuBox.x + menuBox.width).toBeLessThan(viewBox.x);
			expect(viewBox.width).toBe(32);
			expect(viewBox.height).toBe(32);
			expect(viewIconBox.width).toBe(16);
			expect(viewIconBox.height).toBe(16);
		}

		await viewAlpha.click();
		await expect(panel).toBeVisible();
		await expect(page.locator(`[data-doc="${alpha}"]`)).toBeVisible();
		await expect(page.locator(`[data-doc="${beta}"]`)).toBeVisible();
		await expect
			.poll(async () => {
				const box = await page.locator(`[data-doc="${alpha}"]`).boundingBox();
				const canvas = await page
					.locator("[data-canvas-workspace]")
					.boundingBox();
				if (!box || !canvas) return 100;
				const x = Math.abs(
					box.x + box.width / 2 - (canvas.x + canvas.width / 2),
				);
				const y = Math.abs(
					box.y + box.height / 2 - (canvas.y + canvas.height / 2),
				);
				return Math.round(Math.max(x, y));
			})
			.toBeLessThanOrEqual(12);
	});

	test("reframes the focused document when another workspace document is closed", async ({
		mcp,
		page,
	}) => {
		const alpha = "Close steady alpha";
		const beta = "Close steady beta";
		await openWorkspace(page);
		await createDocument(mcp, alpha);
		await createDocument(mcp, beta);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: alpha,
			page: 1,
		});
		await expect(page.locator(`[data-doc="${alpha}"]`)).toBeVisible();
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: beta,
			page: 1,
		});
		const alphaDocument = page.locator(`[data-doc="${alpha}"]`);
		const betaDocument = page.locator(`[data-doc="${beta}"]`);
		await expect(betaDocument).toBeVisible();
		await page.waitForTimeout(50);

		await alphaDocument
			.getByRole("button", { name: /^(Close|Fermer)$/ })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(alphaDocument).toHaveCount(0);
		await page.waitForTimeout(350);

		await expect(betaDocument).toBeVisible();
		await expect
			.poll(async () => {
				const box = await betaDocument.boundingBox();
				const canvas = await page
					.locator("[data-canvas-workspace]")
					.boundingBox();
				if (!box || !canvas) return 100;
				const x = Math.abs(
					box.x + box.width / 2 - (canvas.x + canvas.width / 2),
				);
				const y = Math.abs(
					box.y + box.height / 2 - (canvas.y + canvas.height / 2),
				);
				return Math.round(Math.max(x, y));
			})
			.toBeLessThanOrEqual(12);
	});

	test("keeps the remaining document focused when the active handle is closed", async ({
		mcp,
		page,
	}) => {
		const alpha = "Close active alpha";
		const beta = "Close active beta";
		await openWorkspace(page);
		await createDocument(mcp, alpha);
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
		const alphaDocument = page.locator(`[data-doc="${alpha}"]`);
		const betaDocument = page.locator(`[data-doc="${beta}"]`);
		await expect(betaDocument).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Document", exact: true }),
		).toContainText(beta);

		await betaDocument
			.getByRole("button", { name: /^(Close|Fermer)$/ })
			.click();

		await expect(betaDocument).toHaveCount(0);
		await expect(alphaDocument).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Document", exact: true }),
		).toContainText(alpha);
		await expect(
			alphaDocument.locator('[data-active-page="true"]'),
		).toBeVisible();
	});

	test("closes one or every document from the header selector", async ({
		mcp,
		page,
	}) => {
		const alpha = "Picker close alpha";
		const beta = "Picker close beta";
		const gamma = "Picker close gamma";
		await openWorkspace(page);
		await createDocument(mcp, alpha);
		await createDocument(mcp, beta);
		await createDocument(mcp, gamma);
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
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: gamma,
			page: 1,
		});

		await page.getByRole("button", { name: /^(Document)$/i }).click();
		await page
			.getByRole("button", {
				name: new RegExp(`^(Close|Fermer) ${alpha}$`),
			})
			.click();
		await expect(page.getByRole("option", { name: alpha })).toHaveCount(0);
		await expect(page.getByRole("option", { name: beta })).toBeVisible();
		await expect(page.getByRole("option", { name: gamma })).toBeVisible();

		await page
			.getByRole("button", {
				name: new RegExp(`^(Close|Fermer) ${gamma}$`),
			})
			.click();
		await expect(
			page.getByRole("button", { name: "Document", exact: true }),
		).toContainText(beta);
		await expect(page.locator(`[data-doc="${beta}"]`)).toBeVisible();

		await page.getByRole("button", { name: "Document", exact: true }).click();
		await page
			.getByRole("button", { name: /^(Close all|Tout fermer)$/i })
			.click();
		await expect(
			page.getByRole("button", {
				name: /Open (?:a )?document|Ouvrir un document/i,
			}),
		).toBeVisible();
		await expect(page.locator("[data-doc]")).toHaveCount(0);
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
			.getByRole("menuitem", {
				name: /Export \(\.maket\)|Exporter \(\.maket\)/i,
			})
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
	return openLibraryView(page, "docs");
}

function docRow(panel: Locator, name: string): Locator {
	return panel.locator(`[data-doc-row="${name}"]`);
}

function docButton(panel: Locator, name: string): Locator {
	return docRow(panel, name).locator("button").first();
}

async function openDocumentMenu(row: Locator): Promise<void> {
	await row.hover();
	await row.getByRole("button", { name: /^(Actions)$/i }).click();
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
