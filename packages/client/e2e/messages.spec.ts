import { expect, test } from "./isolated-test";
import { McpTestClient } from "./mcp-test-client";
import { closeLibrary, libraryBadge, openLibraryView } from "./workspace-test";

const NOTE_TEXT = "Make this title more prominent";
const DOCUMENT_NOTE_TEXT = "Review the overall document hierarchy";

async function waitForWorkspace(page: import("@playwright/test").Page) {
	await expect(
		page.getByRole("button", { name: /^(exchanges|échanges)$/i }),
	).toBeVisible();
	await expect(page.locator(".animate-pulse.bg-danger")).toHaveCount(0);
}

async function cleanupMessage(mcp: McpTestClient, text: string) {
	try {
		const messages = await mcp.callJson<Array<{ id: string; text?: string }>>(
			"maket_workspace",
			{ action: "list_messages" },
		);
		const ids = messages
			.filter((message) => message.text === text)
			.map((message) => message.id);
		if (ids.length > 0) {
			await mcp.call("maket_workspace", { action: "ack_messages", ids });
		}
	} catch {}
}

test.describe("Document annotations", () => {
	test("an element annotation survives another window and its acknowledgement propagates", async ({
		baseURL,
		context,
		page,
	}) => {
		const docName = `annotation-e2e-${Date.now()}`;
		const otherDocName = `${docName}-other`;
		const mcp = await McpTestClient.connect(baseURL);

		try {
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
				html: [
					'<main data-id="page" style="padding: 20mm">',
					'<h1 data-id="review-title" data-name="Review title">Annotation review</h1>',
					'<p data-id="review-copy">A real persisted document.</p>',
					"</main>",
				].join(""),
			});
			await mcp.call("maket_doc", {
				action: "new",
				doc: otherDocName,
				format: "A4",
				orientation: "portrait",
			});
			await mcp.call("maket_html", {
				action: "set",
				doc: otherDocName,
				page: 1,
				html: [
					'<main data-id="other-page" style="padding: 20mm">',
					'<h1 data-id="review-title">Same id, different document</h1>',
					"</main>",
				].join(""),
			});

			await page.goto("/");
			await waitForWorkspace(page);
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: otherDocName,
				page: 1,
			});
			const otherTitle = page.locator(
				`[data-doc="${otherDocName}"] [data-id="review-title"]`,
			);
			const otherMarker = page.locator(
				`[data-doc="${otherDocName}"] [data-annotation-marker="review-title"]`,
			);
			await expect(otherTitle).toBeVisible();
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: docName,
				page: 1,
			});
			const title = page.locator(
				`[data-doc="${docName}"] [data-id="review-title"]`,
			);
			const marker = page.locator(
				`[data-doc="${docName}"] [data-annotation-marker="review-title"]`,
			);
			await expect(title).toBeVisible();
			await title.evaluate((element) => {
				(
					element as HTMLElement & { maketDomIdentity?: string }
				).maketDomIdentity = "preserved";
			});

			await title.click();
			await page.locator(".tb-comment").click();
			await page
				.getByPlaceholder(/Note pour l'agent|Note for the agent/i)
				.fill(NOTE_TEXT);
			await page.keyboard.press("Enter");

			const messagesButton = page.getByRole("button", {
				name: /^(exchanges|échanges)$/i,
			});
			await expect(messagesButton).toHaveAttribute("aria-expanded", "false");
			await expect(page.locator("#panel-exchange")).toHaveCount(0);
			await expect(page.locator("[data-library-panel]")).toBeVisible();
			await expect(libraryBadge(messagesButton)).toHaveText("1");
			await expect(marker).toBeVisible();
			await expect(otherMarker).toHaveCount(0);
			expect(
				await title.evaluate(
					(element) =>
						(element as HTMLElement & { maketDomIdentity?: string })
							.maketDomIdentity,
				),
			).toBe("preserved");
			expect(
				await title.evaluate((element) => getComputedStyle(element).position),
			).toBe("static");
			await messagesButton.click();
			await expect(messagesButton).toHaveAttribute("aria-expanded", "true");
			await expect(
				page.getByRole("complementary", { name: /exchanges|échanges/i }),
			).toBeVisible();
			const messageCard = page
				.getByText(NOTE_TEXT)
				.locator("xpath=ancestor::article[1]");
			await expect(
				messageCard.getByRole("button", {
					name: /Open target|Afficher la cible/i,
				}),
			).toBeVisible();
			await expect(
				messageCard.getByRole("button", {
					name: /Delete note|Supprimer la note/i,
				}),
			).toBeVisible();
			await messageCard.hover();
			await expect(title).toHaveAttribute("data-maket-message-target", "");
			await expect(otherTitle).not.toHaveAttribute(
				"data-maket-message-target",
				"",
			);
			await messagesButton.click();
			await expect(messagesButton).toHaveAttribute("aria-expanded", "false");
			await expect(
				page.getByRole("complementary", { name: /exchanges|échanges/i }),
			).toHaveCount(0);

			// A message remains actionable after its document has been removed from
			// the workspace: View reopens it, focuses the page, and reveals the target.
			await openLibraryView(page, "docs");
			await page
				.locator("[data-library-panel]")
				.getByRole("button", { name: docName, exact: true })
				.click();
			await expect(title).toHaveCount(0);
			await closeLibrary(page);
			await messagesButton.click();
			await messageCard
				.getByRole("button", { name: /Open target|Afficher la cible/i })
				.click();
			await expect(title).toBeVisible();
			await expect(libraryBadge(messagesButton)).toHaveText("1");
			const reopenedMessages = await mcp.callJson<
				Array<{
					docName?: string;
					pageIndex?: number;
					elementId?: string;
					text?: string;
				}>
			>("maket_workspace", { action: "list_messages" });
			expect(
				reopenedMessages.find((message) => message.text === NOTE_TEXT),
			).toMatchObject({
				docName,
				pageIndex: 0,
				elementId: "review-title",
			});
			await expect(
				title.locator("xpath=ancestor::*[@data-page][1]"),
			).toHaveAttribute("data-page", "0");
			await expect(marker).toBeVisible();

			const secondPage = await context.newPage();
			await secondPage.goto("/");
			await waitForWorkspace(secondPage);
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: docName,
				page: 1,
			});
			const secondTitle = secondPage.locator(
				`[data-doc="${docName}"] [data-id="review-title"]`,
			);
			const secondMarker = secondPage.locator(
				`[data-doc="${docName}"] [data-annotation-marker="review-title"]`,
			);
			await expect(secondTitle).toBeVisible();
			await expect(secondMarker).toBeVisible();

			const secondMessagesButton = secondPage.getByRole("button", {
				name: /^(exchanges|échanges)$/i,
			});
			await expect(libraryBadge(secondMessagesButton)).toHaveText("1");
			await openLibraryView(secondPage, "exchange");
			await expect(secondPage.getByText(NOTE_TEXT)).toBeVisible();

			await secondPage.reload();
			await waitForWorkspace(secondPage);
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: docName,
				page: 1,
			});
			await expect(secondMarker).toBeVisible();
			await openLibraryView(secondPage, "exchange");
			await expect(secondPage.getByText(NOTE_TEXT)).toBeVisible();

			const messages = await mcp.callJson<Array<{ id: string; text?: string }>>(
				"maket_workspace",
				{ action: "list_messages" },
			);
			const annotation = messages.find((message) => message.text === NOTE_TEXT);
			expect(
				annotation,
				"the agent can read the persisted annotation",
			).toBeDefined();
			if (!annotation) throw new Error("Persisted annotation was not returned");

			await mcp.call("maket_workspace", {
				action: "ack_messages",
				ids: [annotation.id],
			});

			await expect(
				page
					.getByRole("button", { name: /^(exchanges|échanges)$/i })
					.locator("span:not([data-library-rail-icon])"),
			).toHaveCount(0);
			await expect(libraryBadge(secondMessagesButton)).toHaveCount(0);
			await expect(marker).toHaveCount(0);
			await expect(secondMarker).toHaveCount(0);
			await expect(secondPage.getByText(NOTE_TEXT)).toHaveCount(0);
		} finally {
			await cleanupMessage(mcp, NOTE_TEXT);
			await mcp.close();
		}
	});

	test("a document-level annotation survives another window and its acknowledgement propagates", async ({
		baseURL,
		context,
		page,
	}) => {
		const docName = `document-annotation-e2e-${Date.now()}`;
		const mcp = await McpTestClient.connect(baseURL);

		try {
			await mcp.call("maket_doc", {
				action: "new",
				doc: docName,
				format: "A4",
				orientation: "portrait",
			});

			await page.goto("/");
			await waitForWorkspace(page);
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: docName,
				page: 1,
			});

			const messagesButton = page.getByRole("button", {
				name: /^(exchanges|échanges)$/i,
			});
			await messagesButton.click();
			await page
				.getByPlaceholder(/Note sur le document|Note about the document/i)
				.fill(DOCUMENT_NOTE_TEXT);
			await page.keyboard.press("Enter");
			await expect(libraryBadge(messagesButton)).toHaveText("1");
			await expect(
				page.locator(`[data-doc="${docName}"] [data-annotation-page-marker]`),
			).toBeVisible();
			await expect(page.getByText(DOCUMENT_NOTE_TEXT)).toBeVisible();
			const documentMessage = page
				.getByText(DOCUMENT_NOTE_TEXT)
				.locator("xpath=ancestor::article[1]");
			await expect(
				documentMessage.getByRole("button", {
					name: /Open target|Afficher la cible/i,
				}),
			).toBeVisible();
			await expect(
				documentMessage.getByRole("button", {
					name: /Delete note|Supprimer la note/i,
				}),
			).toBeVisible();

			const secondPage = await context.newPage();
			await secondPage.goto("/");
			await waitForWorkspace(secondPage);
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: docName,
				page: 1,
			});
			const secondMessagesButton = secondPage.getByRole("button", {
				name: /^(exchanges|échanges)$/i,
			});
			await expect(libraryBadge(secondMessagesButton)).toHaveText("1");
			await expect(
				secondPage.locator(
					`[data-doc="${docName}"] [data-annotation-page-marker]`,
				),
			).toBeVisible();
			await openLibraryView(secondPage, "exchange");
			await expect(secondPage.getByText(DOCUMENT_NOTE_TEXT)).toBeVisible();

			await secondPage.reload();
			await waitForWorkspace(secondPage);
			await mcp.call("maket_workspace", {
				action: "focus",
				doc: docName,
				page: 1,
			});
			await openLibraryView(secondPage, "exchange");
			await expect(secondPage.getByText(DOCUMENT_NOTE_TEXT)).toBeVisible();

			const messages = await mcp.callJson<
				Array<{
					id: string;
					docName?: string;
					elementId?: string;
					text?: string;
				}>
			>("maket_workspace", { action: "list_messages" });
			const annotation = messages.find(
				(message) => message.text === DOCUMENT_NOTE_TEXT,
			);
			expect(annotation).toMatchObject({ docName, text: DOCUMENT_NOTE_TEXT });
			expect(annotation?.elementId).toBeUndefined();
			if (!annotation) throw new Error("Document annotation was not returned");

			await mcp.call("maket_workspace", {
				action: "ack_messages",
				ids: [annotation.id],
			});

			await expect(libraryBadge(messagesButton)).toHaveCount(0);
			await expect(libraryBadge(secondMessagesButton)).toHaveCount(0);
			await expect(
				secondPage.locator(
					`[data-doc="${docName}"] [data-annotation-page-marker]`,
				),
			).toHaveCount(0);
			await expect(page.getByText(DOCUMENT_NOTE_TEXT)).toHaveCount(0);
			await expect(secondPage.getByText(DOCUMENT_NOTE_TEXT)).toHaveCount(0);
		} finally {
			await cleanupMessage(mcp, DOCUMENT_NOTE_TEXT);
			await mcp.close();
		}
	});
});
