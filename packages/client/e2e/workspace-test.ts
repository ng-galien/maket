import type { Locator, Page } from "@playwright/test";
import { expect, test as isolatedTest } from "./isolated-test";
import { McpTestClient } from "./mcp-test-client";

interface WorkspaceFixtures {
	mcp: McpTestClient;
}

export const test = isolatedTest.extend<WorkspaceFixtures>({
	mcp: async ({ baseURL }, use) => {
		const mcp = await McpTestClient.connect(baseURL);
		try {
			await use(mcp);
		} finally {
			await mcp.close();
		}
	},
});

export { expect };

export async function openWorkspace(page: Page): Promise<void> {
	await page.goto("/");
	await expect(page.locator(".animate-pulse.bg-danger")).toHaveCount(0, {
		timeout: 5_000,
	});
}

export type LibraryView =
	| "docs"
	| "chartes"
	| "photos"
	| "collections"
	| "exchange";

export async function openLibraryView(
	page: Page,
	view: LibraryView,
): Promise<Locator> {
	const panel = page.locator("[data-library-panel]");
	if ((await panel.getAttribute("data-library-mode")) === "compact") {
		await panel.locator(`[data-library-rail-view="${view}"]`).click();
	} else if ((await panel.getAttribute("data-library-view")) !== view) {
		await panel.locator(`[data-library-rail-view="${view}"]`).click();
	}
	await expect(panel).toBeVisible();
	await expect(panel).toHaveAttribute("data-library-mode", "extended");
	return panel;
}

export async function closeLibrary(page: Page): Promise<void> {
	const panel = page.locator("[data-library-panel]");
	if ((await panel.getAttribute("data-library-mode")) === "compact") return;
	await page.locator("[data-library-toggle]").click();
	await expect(panel).toHaveAttribute("data-library-mode", "compact");
}

export async function createDocument(
	mcp: McpTestClient,
	doc: string,
	options: { category?: string; html?: string } = {},
): Promise<void> {
	await mcp.call("maket_doc", {
		action: "new",
		doc,
		format: "A4",
		orientation: "portrait",
		...(options.category ? { category: options.category } : {}),
	});
	await mcp.call("maket_html", {
		action: "set",
		doc,
		page: 1,
		html:
			options.html ??
			`<main data-id="page"><h1 data-id="title">${doc}</h1></main>`,
	});
}
