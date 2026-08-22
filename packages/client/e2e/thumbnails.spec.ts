import type { Locator } from "@playwright/test";
import { expect, openLibraryView, openWorkspace, test } from "./workspace-test";

test.describe("Document thumbnails", () => {
	test("refreshes a rendered thumbnail when the agent changes its charte", async ({
		mcp,
		page,
	}) => {
		const docName = "Live charte thumbnail";
		const charteName = "Thumbnail identity";
		await mcp.call("maket_charte", {
			action: "set",
			name: charteName,
			tokens: { color: { primary: "#164e63" } },
		});
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A4",
			orientation: "portrait",
			charte: charteName,
		});
		const charte = await mcp.callText("maket_charte", {
			action: "view",
			name: charteName,
		});
		const contextToken = charte.match(/context_token:\s*(\S+)/)?.[1];
		expect(contextToken).toBeTruthy();
		await mcp.call("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			context_token: contextToken,
			html: [
				'<main data-id="thumbnail-page" style="width:210mm;height:297mm;background:var(--charte-color-primary);padding:12mm">',
				'<h1 style="color:white">Live thumbnail</h1>',
				"</main>",
			].join(""),
		});

		await openWorkspace(page);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});
		const panel = await openLibraryView(page, "docs");
		await panel
			.getByRole("button", { name: /grid view|vue vignettes/i })
			.click();
		const thumbnail = panel.getByRole("img", { name: docName });
		const initialSrc = await loadedSource(thumbnail);
		expect(await centerPixel(thumbnail)).toEqual([22, 78, 99]);

		await mcp.call("maket_charte", {
			action: "set",
			name: charteName,
			tokens: { color: { primary: "#c2410c" } },
		});
		await expect(
			page.locator(`[data-doc="${docName}"] [data-id="thumbnail-page"]`),
		).toHaveCSS("background-color", "rgb(194, 65, 12)");
		await expect.poll(() => loadedSource(thumbnail)).not.toBe(initialSrc);
		await expect.poll(() => centerPixel(thumbnail)).toEqual([194, 65, 12]);
	});
});

async function loadedSource(image: Locator): Promise<string> {
	await expect
		.poll(() =>
			image.evaluate(
				(node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
			),
		)
		.toBe(true);
	return image.getAttribute("src").then((src) => src ?? "");
}

async function centerPixel(image: Locator): Promise<number[]> {
	return image.evaluate((node: HTMLImageElement) => {
		const canvas = document.createElement("canvas");
		canvas.width = node.naturalWidth;
		canvas.height = node.naturalHeight;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas 2D context is unavailable");
		context.drawImage(node, 0, 0);
		return Array.from(
			context
				.getImageData(
					Math.floor(canvas.width / 2),
					Math.floor(canvas.height / 2),
					1,
					1,
				)
				.data.slice(0, 3),
		);
	});
}
