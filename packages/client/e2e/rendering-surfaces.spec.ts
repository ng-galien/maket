import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, openWorkspace, test } from "./workspace-test";

const execFileAsync = promisify(execFile);

interface DocumentSpec {
	format: "A3" | "A4" | "A5" | "A6";
	orientation: "portrait" | "landscape";
	w: number;
	h: number;
}

interface PrintMargins {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

const A3_LANDSCAPE: DocumentSpec = {
	format: "A3",
	orientation: "landscape",
	w: 420,
	h: 297,
};
const A5_PORTRAIT: DocumentSpec = {
	format: "A5",
	orientation: "portrait",
	w: 148,
	h: 210,
};

test.describe("Rendering surface isolation", () => {
	test("keeps an authored .page aligned in Canvas, Reader, and the direct snapshot", async ({
		mcp,
		page,
	}) => {
		const docName = "A3 authored page rendering contract";
		await createAuthoredPage(mcp, docName, A3_LANDSCAPE);
		await openWorkspace(page);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		await expectAuthoredPageAligned(page, docName);
		await page
			.getByRole("button", { name: /Reading view|Vue lecture/i })
			.click();
		await expectAuthoredPageAligned(page, docName);

		const snapshot = await mcp.call("maket_preview", {
			action: "snapshot",
			doc: docName,
			page: 1,
			path: "a3-authored-page-rendering-contract.png",
		});
		const image = snapshot.content.find((item) => item.type === "image");
		if (image?.type !== "image") {
			throw new Error("maket_preview did not return an image");
		}
		const snapshotPage = await page.context().newPage();
		await snapshotPage.setContent(
			`<img alt="A3 snapshot" src="data:image/png;base64,${image.data}">`,
		);
		const snapshotImage = snapshotPage.getByRole("img", {
			name: "A3 snapshot",
		});
		await expect(snapshotImage).toHaveJSProperty("naturalWidth", 1588);
		await expect(snapshotImage).toHaveJSProperty("naturalHeight", 1123);
		expect(await imagePixel(snapshotImage, 0.5, 0.5)).toEqual([26, 54, 93]);
		expect(
			await imagePixel(
				snapshotImage,
				edgeMarkerRatio(A3_LANDSCAPE.w),
				edgeMarkerRatio(A3_LANDSCAPE.h),
			),
		).toEqual([34, 197, 94]);
	});

	for (const [name, spec] of [
		["A3 landscape", A3_LANDSCAPE],
		["A5 portrait", A5_PORTRAIT],
	] as const) {
		test(`keeps an authored .page isolated in ${name} thumbnail and print/PDF`, async ({
			mcp,
			page,
		}, testInfo) => {
			const docName = `${name} authored page export contract`;
			await createAuthoredPage(mcp, docName, spec);
			await expectExportSurfaces(page, mcp, docName, spec, testInfo);
		});
	}

	test("preserves every render surface while one document changes size and orientation", async ({
		mcp,
		page,
	}, testInfo) => {
		test.setTimeout(120_000);
		const docName = "Evolving page export contract";
		const stages: Array<{
			name: string;
			spec: DocumentSpec;
			margins: PrintMargins;
		}> = [
			{
				name: "small A6 portrait",
				spec: { format: "A6", orientation: "portrait", w: 105, h: 148 },
				margins: { top: 5, right: 6, bottom: 7, left: 8 },
			},
			{
				name: "large A3 landscape",
				spec: A3_LANDSCAPE,
				margins: { top: 10, right: 12, bottom: 14, left: 16 },
			},
			{
				name: "A4 portrait",
				spec: { format: "A4", orientation: "portrait", w: 210, h: 297 },
				margins: { top: 25, right: 20, bottom: 25, left: 20 },
			},
			{
				name: "A4 landscape",
				spec: { format: "A4", orientation: "landscape", w: 297, h: 210 },
				margins: { top: 8, right: 10, bottom: 12, left: 14 },
			},
		];

		await createResponsiveAuthoredPage(mcp, docName, stages[0].spec);
		await openWorkspace(page);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});
		const surfacePage = await page.context().newPage();
		await surfacePage.addInitScript(() => {
			window.print = () => undefined;
		});

		let previousThumbnailSource: string | null = null;
		for (const stage of stages) {
			await mcp.call("maket_canvas", {
				doc: docName,
				format: stage.spec.format,
				orientation: stage.spec.orientation,
				margins: stage.margins,
			});
			previousThumbnailSource = await expectLifecycleStage({
				page,
				mcp,
				docName,
				stageName: stage.name,
				spec: stage.spec,
				margins: stage.margins,
				previousThumbnailSource,
				surfacePage,
				testInfo,
			});
		}
	});
});

interface McpLike {
	call(
		name: string,
		args: Record<string, unknown>,
	): Promise<{
		content: Array<{ type: string; data?: string; mimeType?: string }>;
	}>;
	callText(name: string, args: Record<string, unknown>): Promise<string>;
}

async function createAuthoredPage(
	mcp: McpLike,
	docName: string,
	spec: DocumentSpec,
): Promise<void> {
	await mcp.call("maket_doc", {
		action: "new",
		doc: docName,
		format: spec.format,
		orientation: spec.orientation,
	});
	await mcp.call("maket_html", {
		action: "set",
		doc: docName,
		page: 1,
		html: authoredPageHtml(spec),
	});
}

async function createResponsiveAuthoredPage(
	mcp: McpLike,
	docName: string,
	initial: DocumentSpec,
): Promise<void> {
	await mcp.call("maket_doc", {
		action: "new",
		doc: docName,
		format: initial.format,
		orientation: initial.orientation,
	});
	await mcp.call("maket_html", {
		action: "set",
		doc: docName,
		page: 1,
		html: [
			"<style>",
			".page { width:100%; height:100%; padding:10mm; overflow:hidden; background:#1a365d; position:relative; }",
			".page h1 { color:#ffffff; font:700 9mm/1 sans-serif; }",
			".edge-marker { position:absolute; right:10mm; bottom:10mm; width:12mm; height:12mm; background:#22c55e; }",
			"</style>",
			'<main class="page" data-id="authored-page">',
			'<h1 data-id="title">Evolving rendering contract</h1>',
			'<div class="edge-marker" data-id="edge-marker"></div>',
			"</main>",
		].join(""),
	});
}

function authoredPageHtml(spec: DocumentSpec): string {
	return [
		"<style>",
		`.page { width:${spec.w}mm; height:${spec.h}mm; padding:10mm; overflow:hidden; background:#1a365d; position:relative; }`,
		".page h1 { color:#ffffff; font:700 12mm/1 sans-serif; }",
		".edge-marker { position:absolute; right:10mm; bottom:10mm; width:12mm; height:12mm; background:#22c55e; }",
		"</style>",
		'<main class="page" data-id="authored-page">',
		`<h1 data-id="title">${spec.format} ${spec.orientation} rendering contract</h1>`,
		'<div class="edge-marker" data-id="edge-marker"></div>',
		"</main>",
	].join("");
}

async function expectExportSurfaces(
	page: Page,
	mcp: McpLike,
	docName: string,
	spec: DocumentSpec,
	testInfo: TestInfo,
): Promise<void> {
	await openWorkspace(page);
	await mcp.call("maket_workspace", {
		action: "focus",
		doc: docName,
		page: 1,
	});

	await page.getByRole("button", { name: /^documents$/i }).click();
	const panel = page.getByRole("complementary", { name: /^documents$/i });
	await panel.getByRole("button", { name: /grid view|vue vignettes/i }).click();
	const thumbnail = panel.getByRole("img", { name: docName });
	await expectThumbnailLoaded(thumbnail);
	expect(await imagePixel(thumbnail, 0.5, 0.5)).toEqual([26, 54, 93]);
	expect(
		await imagePixel(
			thumbnail,
			edgeMarkerRatio(spec.w),
			edgeMarkerRatio(spec.h),
		),
	).toEqual([34, 197, 94]);

	const printPage = await page.context().newPage();
	await printPage.addInitScript(() => {
		window.print = () => undefined;
	});
	await printPage.goto(`/print?name=${encodeURIComponent(docName)}`);
	const geometry = await printPage
		.locator('[data-id="authored-page"]')
		.evaluate((node) => {
			const authored = node.getBoundingClientRect();
			const frame = node.parentElement?.getBoundingClientRect();
			if (!frame) throw new Error("Print frame is missing");
			return {
				left: authored.left - frame.left,
				top: authored.top - frame.top,
				width: authored.width - frame.width,
				height: authored.height - frame.height,
			};
		});
	expect(Math.abs(geometry.left), "print left edge").toBeLessThan(1);
	expect(Math.abs(geometry.top), "print top edge").toBeLessThan(1);
	expect(Math.abs(geometry.width), "print width").toBeLessThan(1);
	expect(Math.abs(geometry.height), "print height").toBeLessThan(1);

	const pdfResult = await mcp.callText("maket_pdf", {
		doc: docName,
		quality: "screen",
		rows: "preview",
	});
	expect(pdfResult).toContain("1 page");
	const pdfPath = pdfResult.match(/^PDF exported:\s*(.+?)\s+\(/)?.[1];
	if (!pdfPath) throw new Error(`PDF path is missing for ${docName}`);
	await expectPdfPixels(printPage, pdfPath, spec, docName, testInfo);
}

async function expectLifecycleStage({
	page,
	mcp,
	docName,
	stageName,
	spec,
	margins,
	previousThumbnailSource,
	surfacePage,
	testInfo,
}: {
	page: Page;
	mcp: McpLike;
	docName: string;
	stageName: string;
	spec: DocumentSpec;
	margins: PrintMargins;
	previousThumbnailSource: string | null;
	surfacePage: Page;
	testInfo: TestInfo;
}): Promise<string> {
	await expectCanvasGeometry(page, docName, spec, stageName);
	await expectMarginGuide(page, docName, margins, stageName);
	await page.getByRole("button", { name: /Reading view|Vue lecture/i }).click();
	await expectCanvasGeometry(page, docName, spec, `${stageName} Reader`);
	await expect(
		page.locator(`[data-doc="${docName}"] .margin-guide`),
		`${stageName} Reader hides print guides`,
	).toHaveCount(0);
	await page.getByRole("button", { name: /Canvas view|Vue canevas/i }).click();

	const snapshot = await mcp.call("maket_preview", {
		action: "snapshot",
		doc: docName,
		page: 1,
		path: `lifecycle-${spec.format}-${spec.orientation}.png`,
	});
	const image = snapshot.content.find((item) => item.type === "image");
	if (!image?.data) throw new Error("maket_preview did not return an image");
	await surfacePage.setContent(
		`<img alt="${stageName} snapshot" src="data:image/png;base64,${image.data}">`,
	);
	const snapshotImage = surfacePage.getByRole("img", {
		name: `${stageName} snapshot`,
	});
	await expect(snapshotImage).toHaveJSProperty(
		"naturalWidth",
		Math.ceil(spec.w * 3.78),
	);
	await expect(snapshotImage).toHaveJSProperty(
		"naturalHeight",
		Math.ceil(spec.h * 3.78),
	);
	expect(await imagePixel(snapshotImage, 0.5, 0.5)).toEqual([26, 54, 93]);
	expect(
		await imagePixel(
			snapshotImage,
			edgeMarkerRatio(spec.w),
			edgeMarkerRatio(spec.h),
		),
	).toEqual([34, 197, 94]);
	await page.getByRole("button", { name: /^documents$/i }).click();
	const panel = page.getByRole("complementary", { name: /^documents$/i });
	await panel.getByRole("button", { name: /grid view|vue vignettes/i }).click();
	const thumbnail = panel.getByRole("img", { name: docName });
	await expectThumbnailLoaded(thumbnail);
	if (previousThumbnailSource) {
		await expect
			.poll(() => thumbnail.getAttribute("src"), {
				message: `${stageName} thumbnail cache key`,
			})
			.not.toBe(previousThumbnailSource);
	}
	const thumbnailSource = (await thumbnail.getAttribute("src")) ?? "";
	await expect(thumbnail).toHaveJSProperty("naturalWidth", 960);
	await expect(thumbnail).toHaveJSProperty(
		"naturalHeight",
		Math.round((spec.h / spec.w) * 480) * 2,
	);
	expect(await imagePixel(thumbnail, 0.5, 0.5)).toEqual([26, 54, 93]);
	expect(
		await imagePixel(
			thumbnail,
			edgeMarkerRatio(spec.w),
			edgeMarkerRatio(spec.h),
		),
	).toEqual([34, 197, 94]);
	await page
		.getByRole("button", { name: /Close Documents|Fermer.*documents/i })
		.click();

	await surfacePage.goto(`/print?name=${encodeURIComponent(docName)}`);
	await expectPrintGeometry(surfacePage, spec, stageName);
	await expect(
		surfacePage.locator(".margin-guide"),
		`${stageName} print excludes the informational guide`,
	).toHaveCount(0);

	const pdfResult = await mcp.callText("maket_pdf", {
		doc: docName,
		quality: "screen",
		rows: "preview",
	});
	expect(pdfResult).toContain("1 page");
	const pdfPath = pdfResult.match(/^PDF exported:\s*(.+?)\s+\(/)?.[1];
	if (!pdfPath) throw new Error(`PDF path is missing for ${stageName}`);
	const pdf = await readFile(pdfPath);
	expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
	const mediaBox = pdf
		.toString("latin1")
		.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
	if (!mediaBox) throw new Error(`PDF MediaBox is missing for ${stageName}`);
	expect(
		Math.abs(Number(mediaBox[1]) - (spec.w * 72) / 25.4),
		`${stageName} PDF width`,
	).toBeLessThan(1);
	expect(
		Math.abs(Number(mediaBox[2]) - (spec.h * 72) / 25.4),
		`${stageName} PDF height`,
	).toBeLessThan(1);
	await expectPdfPixels(surfacePage, pdfPath, spec, stageName, testInfo);

	return thumbnailSource;
}

async function expectPdfPixels(
	page: Page,
	pdfPath: string,
	spec: DocumentSpec,
	label: string,
	testInfo: TestInfo,
): Promise<void> {
	const prefix = testInfo.outputPath(
		`pdf-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
	);
	await mkdir(dirname(prefix), { recursive: true });
	await execFileAsync("pdftoppm", [
		"-f",
		"1",
		"-l",
		"1",
		"-singlefile",
		"-png",
		"-r",
		"96",
		pdfPath,
		prefix,
	]);
	const raster = await readFile(`${prefix}.png`);
	await page.setContent(
		`<img alt="${label} PDF raster" src="data:image/png;base64,${raster.toString("base64")}">`,
	);
	const image = page.getByRole("img", { name: `${label} PDF raster` });
	expect(await imagePixel(image, 0.5, 0.5), `${label} PDF center`).toEqual([
		26, 54, 93,
	]);
	expect(
		await imagePixel(image, edgeMarkerRatio(spec.w), edgeMarkerRatio(spec.h)),
		`${label} PDF edge marker`,
	).toEqual([34, 197, 94]);
}

async function expectMarginGuide(
	page: Page,
	docName: string,
	margins: PrintMargins,
	stageName: string,
): Promise<void> {
	const guide = page.locator(`[data-doc="${docName}"] .margin-guide`);
	await expect(guide, `${stageName} print margin guide`).toBeVisible();
	const measured = await guide.evaluate((node) => {
		const style = getComputedStyle(node);
		return {
			top: Number.parseFloat(style.top),
			right: Number.parseFloat(style.right),
			bottom: Number.parseFloat(style.bottom),
			left: Number.parseFloat(style.left),
		};
	});
	for (const side of ["top", "right", "bottom", "left"] as const) {
		expect(
			Math.abs(measured[side] - (margins[side] * 96) / 25.4),
			`${stageName} ${side} print margin`,
		).toBeLessThan(0.1);
	}
}

async function expectCanvasGeometry(
	page: Page,
	docName: string,
	spec: DocumentSpec,
	stageName: string,
): Promise<void> {
	await expectAuthoredPageAligned(page, docName);
	const ratio = await page
		.locator(`[data-doc="${docName}"] .page-canvas`)
		.getAttribute("style")
		.then((style) => {
			if (!style) throw new Error(`${stageName} canvas style is missing`);
			const width = style.match(/width:\s*([\d.]+)mm/)?.[1];
			const height = style.match(/height:\s*([\d.]+)mm/)?.[1];
			if (!width || !height)
				throw new Error(`${stageName} canvas dimensions are missing`);
			return Number(width) / Number(height);
		});
	expect(ratio, `${stageName} canvas aspect ratio`).toBeCloseTo(
		spec.w / spec.h,
		4,
	);
}

async function expectPrintGeometry(
	printPage: Page,
	spec: DocumentSpec,
	stageName: string,
): Promise<void> {
	const geometry = await printPage
		.locator('[data-id="authored-page"]')
		.evaluate((node) => {
			const authored = node.getBoundingClientRect();
			const frame = node.parentElement?.getBoundingClientRect();
			if (!frame) throw new Error("Print frame is missing");
			return {
				left: authored.left - frame.left,
				top: authored.top - frame.top,
				width: authored.width - frame.width,
				height: authored.height - frame.height,
				frameRatio: frame.width / frame.height,
			};
		});
	expect(Math.abs(geometry.left), `${stageName} print left edge`).toBeLessThan(
		1,
	);
	expect(Math.abs(geometry.top), `${stageName} print top edge`).toBeLessThan(1);
	expect(Math.abs(geometry.width), `${stageName} print width`).toBeLessThan(1);
	expect(Math.abs(geometry.height), `${stageName} print height`).toBeLessThan(
		1,
	);
	expect(geometry.frameRatio, `${stageName} print aspect ratio`).toBeCloseTo(
		spec.w / spec.h,
		4,
	);
}

function edgeMarkerRatio(dimensionMm: number): number {
	return (dimensionMm - 16) / dimensionMm;
}

async function expectAuthoredPageAligned(
	page: Page,
	docName: string,
): Promise<void> {
	const authoredPage = page.locator(
		`[data-doc="${docName}"] [data-id="authored-page"]`,
	);
	await expect(authoredPage).toBeVisible();
	await expect
		.poll(() =>
			authoredPage.evaluate((node) => {
				const authored = node.getBoundingClientRect();
				const canvas = node.closest(".page-canvas")?.getBoundingClientRect();
				if (!canvas) throw new Error("Page canvas is missing");
				return [
					Math.round(authored.left - canvas.left),
					Math.round(authored.top - canvas.top),
					Math.round(authored.width - canvas.width),
					Math.round(authored.height - canvas.height),
				];
			}),
		)
		.toEqual([0, 0, 0, 0]);
}

async function expectThumbnailLoaded(image: Locator): Promise<void> {
	await expect
		.poll(() =>
			image.evaluate(
				(node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
			),
		)
		.toBe(true);
}

async function imagePixel(
	image: Locator,
	xRatio: number,
	yRatio: number,
): Promise<number[]> {
	return image.evaluate(
		(node: HTMLImageElement, ratios) => {
			const canvas = document.createElement("canvas");
			canvas.width = node.naturalWidth;
			canvas.height = node.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas 2D context is unavailable");
			context.drawImage(node, 0, 0);
			return Array.from(
				context
					.getImageData(
						Math.floor(canvas.width * ratios.xRatio),
						Math.floor(canvas.height * ratios.yRatio),
						1,
						1,
					)
					.data.slice(0, 3),
			);
		},
		{ xRatio, yRatio },
	);
}
