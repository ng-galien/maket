import { readFile } from "node:fs/promises";
import { createDocument, expect, openWorkspace, test } from "./workspace-test";

test.describe("Preview and PDF export", () => {
	test("renders the visible document through print, snapshot and PDF", async ({
		context,
		mcp,
		page,
	}) => {
		const docName = "Agent export proof";
		await createDocument(mcp, docName, {
			html: [
				'<main data-id="cover" style="width:148mm;height:210mm;padding:15mm;background:#f0fdfa">',
				'<h1 data-id="cover-title">Export proof cover</h1>',
				"</main>",
			].join(""),
		});
		await mcp.call("maket_page", {
			action: "add",
			doc: docName,
			name: "Details",
			html: [
				'<main data-id="details" style="width:148mm;height:210mm;padding:15mm;background:#ecfeff">',
				'<h2 data-id="details-title">Export proof details</h2>',
				"</main>",
			].join(""),
		});
		await openWorkspace(page);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});
		const document = page.locator(`[data-doc="${docName}"]`);
		await expect(document.getByText("Export proof cover")).toBeVisible();
		await expect(document.getByText("Export proof details")).toBeVisible();

		const printPage = await context.newPage();
		await printPage.addInitScript(() => {
			window.print = () => undefined;
		});
		await printPage.goto(`/print?name=${encodeURIComponent(docName)}`);
		await expect(printPage.locator(".page")).toHaveCount(2);
		await expect(printPage.getByText("Export proof cover")).toBeVisible();
		await expect(printPage.getByText("Export proof details")).toBeVisible();

		const snapshot = await mcp.call("maket_preview", {
			action: "snapshot",
			doc: docName,
			page: 1,
			path: "agent-export-proof.png",
		});
		const image = snapshot.content.find((item) => item.type === "image");
		if (image?.type !== "image") {
			throw new Error("maket_preview did not return an image");
		}
		expect(image.mimeType).toBe("image/png");
		expect(Buffer.from(image.data, "base64").subarray(0, 8)).toEqual(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		);
		const snapshotPage = await context.newPage();
		await snapshotPage.setContent(
			`<img alt="Snapshot proof" src="data:image/png;base64,${image.data}">`,
		);
		const snapshotImage = snapshotPage.getByRole("img", {
			name: "Snapshot proof",
		});
		await expect(snapshotImage).toBeVisible();
		await expect
			.poll(() =>
				snapshotImage.evaluate(
					(node: HTMLImageElement) => node.naturalWidth * node.naturalHeight,
				),
			)
			.toBeGreaterThan(100_000);

		const pdfResult = await mcp.callText("maket_pdf", {
			doc: docName,
			quality: "screen",
			rows: "preview",
		});
		expect(pdfResult).toContain("2 pages");
		const pdfPath = pdfResult.match(/^PDF exported:\s*(.+?)\s+\(/)?.[1];
		expect(pdfPath).toBeTruthy();
		const pdf = await readFile(pdfPath as string);
		expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
		expect(pdf.subarray(-32).toString()).toContain("%%EOF");
		expect(pdf.length).toBeGreaterThan(1_000);
	});
});
