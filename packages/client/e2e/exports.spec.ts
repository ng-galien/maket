import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

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
		await expect(printPage.locator("maket-render-page")).toHaveCount(2);
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

		await expectOutputStyleParity(
			page,
			page.locator("[data-workspace-header]"),
			page.getByRole("button", { name: /Fit to view|Ajuster/i }),
		);
		await page
			.locator("[data-workspace-header]")
			.screenshot({ path: test.info().outputPath("output-toolbar.png") });
		await expect(
			page.getByRole("button", {
				name: /Document actions|Actions du document/i,
			}),
		).toHaveCount(0);
		const downloadReady = page.waitForEvent("download");
		await page
			.getByRole("button", { name: /Export PDF|Exporter en PDF/i })
			.click();
		const download = await downloadReady;
		expect(download.suggestedFilename()).toMatch(/\.pdf$/);
		const downloadedPath = await download.path();
		if (!downloadedPath) throw new Error("PDF download failed");
		const downloadedPdf = await readFile(downloadedPath);
		expect(downloadedPdf.subarray(0, 5).toString()).toBe("%PDF-");

		await page
			.getByRole("button", { name: /Reading view|Vue lecture/i })
			.click();
		const reader = page.getByRole("navigation", {
			name: /Reader navigation|Navigation du lecteur/i,
		});
		await expect(
			reader.getByRole("button", { name: /Print|Imprimer/i }),
		).toHaveText("");
		await expect(
			reader.getByRole("button", { name: /Export PDF|Exporter en PDF/i }),
		).toHaveText("PDF");
		await expectOutputStyleParity(
			page,
			reader,
			reader.getByRole("button", { name: /Close reader|Fermer/i }),
		);
		await reader.screenshot({
			path: test.info().outputPath("reader-output.png"),
		});
		const readerDownloadReady = page.waitForEvent("download");
		await reader
			.getByRole("button", { name: /Export PDF|Exporter en PDF/i })
			.click();
		const readerDownload = await readerDownloadReady;
		expect(await readerDownload.failure()).toBeNull();
		expect(readerDownload.suggestedFilename()).toBe(
			download.suggestedFilename(),
		);
		await context.addInitScript(() => {
			window.print = () => undefined;
		});
		const readerPrintReady = context.waitForEvent("page");
		await reader.getByRole("button", { name: /Print|Imprimer/i }).click();
		const readerPrint = await readerPrintReady;
		await expect(readerPrint.getByText("Export proof cover")).toBeVisible();
		await expect(readerPrint.getByText("Export proof details")).toBeVisible();

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

test("exports the document chosen in the library menu even when another document is focused", async ({
	mcp,
	page,
}) => {
	await createDocument(mcp, "Focused document", { category: "Output" });
	await createDocument(mcp, "Library export target", { category: "Output" });
	await openWorkspace(page);
	await mcp.call("maket_workspace", {
		action: "focus",
		doc: "Focused document",
		page: 1,
	});
	await openLibraryView(page, "docs");
	await page
		.locator('[data-doc-row="Library export target"]')
		.getByRole("button", { name: "Actions", exact: true })
		.click();
	await expect(
		page.getByRole("menuitem", { name: /Print|Imprimer/i }),
	).toBeVisible();
	const downloadReady = page.waitForEvent("download");
	await page
		.getByRole("menuitem", { name: /Export PDF|Exporter en PDF/i })
		.click();
	const download = await downloadReady;
	expect(download.suggestedFilename()).toBe("Library_export_target.pdf");
	expect(await download.failure()).toBeNull();
});

async function expectOutputStyleParity(
	page: Page,
	toolbar: Locator,
	reference: Locator,
) {
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme });
		await expect(page.locator("html")).toHaveAttribute(
			"data-theme",
			colorScheme,
		);
		await page.mouse.move(0, 0);
		const rest = await settledButtonStyle(reference);
		const iconSize = await reference.locator("svg").getAttribute("width");
		for (const name of [/Print|Imprimer/i, /Export PDF|Exporter en PDF/i]) {
			const button = toolbar.getByRole("button", { name });
			await expect(button).toHaveCSS("color", rest.color);
			await expect(button).toHaveCSS("width", rest.width);
			await expect(button).toHaveCSS("height", rest.height);
			await expect(button.locator("svg")).toHaveAttribute(
				"width",
				iconSize ?? "",
			);
			await reference.hover();
			const hovered = await settledButtonStyle(reference);
			await button.hover();
			await expect(button).toHaveCSS("color", hovered.color);
			await expect(button).toHaveCSS("background-color", hovered.background);
			await page.mouse.move(0, 0);
			await settledButtonStyle(button);
		}
	}
}

async function settledButtonStyle(button: Locator) {
	return button.evaluate(async (element) => {
		getComputedStyle(element).color;
		await Promise.all(
			element.getAnimations().map((animation) => animation.finished),
		);
		const style = getComputedStyle(element);
		return {
			color: style.color,
			background: style.backgroundColor,
			width: style.width,
			height: style.height,
		};
	});
}
