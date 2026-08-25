import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, libraryBadge, openWorkspace, test } from "./workspace-test";

const AGENT_LOGO = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"agent-bundle-logo.svg",
);

test.describe("Portable workspace bundles", () => {
	test("restores an agent document with its portable dependencies", async ({
		mcp,
		page,
	}) => {
		const docName = "Portable agent catalogue";
		const charteName = "Portable agent brand";
		const collectionName = "portable_products";
		const assetName = "agent-bundle-logo.svg";
		const noteText = "Keep the portable dependencies together";
		const bundleName = "portable-agent-catalogue.maket";
		await openWorkspace(page);

		await mcp.call("maket_image", {
			action: "import",
			path: AGENT_LOGO,
			filename: assetName,
			title: "Agent bundle logo",
			category: "brand",
			tags: ["portable", "logo"],
		});
		await mcp.call("maket_charte", {
			action: "set",
			name: charteName,
			description: "Portable cyan identity",
			tokens: {
				color: { primary: "#164e63", surface: "#ecfeff" },
			},
			voice: { personality: ["precise"], formality: "professional" },
			rules: { titles: "Keep titles concise" },
		});
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A5",
			orientation: "portrait",
			category: "portable/catalogue",
		});
		await mcp.call("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			html: [
				'<main data-id="catalogue" style="width:148mm;height:210mm;padding:14mm">',
				`<img data-id="logo" alt="Agent bundle logo" src="${assetName}">`,
				'<h1 data-id="product">{{ product_name }}</h1>',
				'<p data-id="price">€{{ price }}</p>',
				"</main>",
			].join(""),
		});
		await mcp.call("maket_doc", {
			action: "meta",
			doc: docName,
			charte: charteName,
			designNotes: "All dependencies must travel with this document",
		});
		await mcp.call("maket_collection", {
			action: "create",
			name: collectionName,
			description: "Portable catalogue products",
			schema: {
				type: "object",
				properties: {
					product_name: { type: "string" },
					price: { type: "number" },
				},
				required: ["product_name", "price"],
			},
		});
		await mcp.call("maket_collection", {
			action: "add_row",
			name: collectionName,
			row: "lamp",
			data: { product_name: "Cyan lamp", price: 79 },
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
			row: "lamp",
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		const document = page.locator(`[data-doc="${docName}"]`);
		await expect(
			document.getByText("Cyan lamp", { exact: true }),
		).toBeVisible();
		const logo = document.getByRole("img", { name: "Agent bundle logo" });
		await expect(logo).toBeVisible();
		await expect
			.poll(() =>
				logo.evaluate((image: HTMLImageElement) => image.naturalWidth),
			)
			.toBeGreaterThan(0);

		const messagesButton = page.getByRole("button", {
			name: /^(exchanges|échanges)$/i,
		});
		await messagesButton.click();
		await page
			.getByPlaceholder(/Note sur le document|Note about the document/i)
			.fill(noteText);
		await page.keyboard.press("Enter");
		await expect(libraryBadge(messagesButton)).toHaveText("1");

		await mcp.call("maket_doc", {
			action: "export",
			docs: [docName],
			output: bundleName,
			include_assets: true,
		});
		await mcp.call("maket_doc", {
			action: "new",
			doc: "Keep portable import workspace alive",
			format: "A4",
			orientation: "portrait",
		});
		await mcp.call("maket_doc", { action: "delete", doc: docName });
		await mcp.call("maket_collection", {
			action: "delete",
			name: collectionName,
		});
		await mcp.call("maket_charte", {
			action: "delete",
			name: charteName,
		});
		await mcp.call("maket_image", {
			action: "delete",
			filename: assetName,
		});
		await expect(document).toHaveCount(0);

		const imported = await mcp.callText("maket_doc", {
			action: "import",
			input: bundleName,
		});
		expect(imported).toContain("Documents: Portable agent catalogue");
		await mcp.call("maket_collection", {
			action: "cursor",
			doc: docName,
			page: 1,
			mode: "rendered",
			row: "lamp",
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		const restored = page.locator(`[data-doc="${docName}"]`);
		await expect(
			restored.getByText("Cyan lamp", { exact: true }),
		).toBeVisible();
		const restoredLogo = restored.getByRole("img", {
			name: "Agent bundle logo",
		});
		await expect
			.poll(() =>
				restoredLogo.evaluate((image: HTMLImageElement) => image.naturalWidth),
			)
			.toBeGreaterThan(0);
		await expect(
			restored.locator("[data-annotation-page-marker]"),
		).toBeVisible();
		await expect(libraryBadge(messagesButton)).toHaveText("1");

		const messages = await mcp.callJson<
			Array<{ text?: string; docName?: string }>
		>("maket_workspace", { action: "list_messages" });
		expect(messages).toContainEqual(
			expect.objectContaining({ text: noteText, docName }),
		);
		const charte = await mcp.callText("maket_charte", {
			action: "view",
			name: charteName,
		});
		expect(charte).toContain("Portable cyan identity");
		const collection = await mcp.callText("maket_collection", {
			action: "view",
			name: collectionName,
		});
		expect(collection).toContain('"product_name":"Cyan lamp"');
		const assets = await mcp.callText("maket_image", { action: "list" });
		expect(assets).toContain("agent-bundle-logo.svg");
	});
});
