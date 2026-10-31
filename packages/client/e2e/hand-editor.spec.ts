import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import type { McpTestClient } from "./mcp-test-client";
import {
	closeLibrary,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

const execFileAsync = promisify(execFile);

const IMAGE_FILL = [29, 78, 216] as const;
const FRAME_BORDER = [51, 65, 85] as const;

interface MmBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

function pageCanvas(page: Page, doc: string, index = 0): Locator {
	return page.locator(`[data-doc="${doc}"] .page-canvas[data-page="${index}"]`);
}

function placed(page: Page, doc: string, prefix: string): Locator {
	return pageCanvas(page, doc).locator(`[data-id^="${prefix}-"]`);
}

/** Page size in mm, measured from the rendered canvas at the board zoom. */
async function pageSizeMm(canvas: Locator): Promise<{ w: number; h: number }> {
	return canvas.evaluate((element: HTMLElement) => ({
		w: (element.offsetWidth * 25.4) / 96,
		h: (element.offsetHeight * 25.4) / 96,
	}));
}

/** Element box in mm relative to its page, measured on screen. */
async function boxMm(
	canvas: Locator,
	element: Locator,
	pageWidthMm: number,
): Promise<MmBox> {
	const pageRect = await canvas.boundingBox();
	const rect = await element.boundingBox();
	if (!pageRect || !rect) throw new Error("box missing");
	const scale = pageWidthMm / pageRect.width;
	return {
		left: (rect.x - pageRect.x) * scale,
		top: (rect.y - pageRect.y) * scale,
		width: rect.width * scale,
		height: rect.height * scale,
	};
}

function expectBox(actual: MmBox, expected: MmBox, tolerance = 0.6) {
	for (const key of ["left", "top", "width", "height"] as const) {
		expect(
			Math.abs(actual[key] - expected[key]),
			`${key}: ${actual[key]} vs ${expected[key]}`,
		).toBeLessThanOrEqual(tolerance);
	}
}

/** Box declared in the stored page HTML for one data-id. */
function storedBox(html: string, id: string): MmBox {
	const match = new RegExp(`data-id="${id}"[^>]*style="([^"]+)"`).exec(html);
	if (!match?.[1]) throw new Error(`style of ${id} missing in ${html}`);
	const style = match[1];
	const read = (name: string) => {
		const value = new RegExp(`(?:^|;)${name}:(-?[\\d.]+)mm`).exec(style)?.[1];
		if (value === undefined) throw new Error(`${name} of ${id} missing`);
		return Number(value);
	};
	return {
		left: read("left"),
		top: read("top"),
		width: read("width"),
		height: read("height"),
	};
}

async function pageHtml(mcp: McpTestClient, doc: string): Promise<string> {
	return mcp.callText("maket_html", { action: "get", doc, page: 1 });
}

async function dragBy(
	page: Page,
	from: { x: number; y: number },
	dx: number,
	dy: number,
) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
	await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
	await page.mouse.up();
}

async function centre(locator: Locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error("box missing");
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pxPerMm(canvas: Locator, pageWidthMm: number) {
	const rect = await canvas.boundingBox();
	if (!rect) throw new Error("page missing");
	return rect.width / pageWidthMm;
}

function composeBar(page: Page): Locator {
	return page.locator("[data-hand-compose-bar]");
}

async function focusPage(page: Page, doc: string, index = 0) {
	const canvas = pageCanvas(page, doc, index);
	const rect = await canvas.boundingBox();
	if (!rect) throw new Error("page missing");
	await page.mouse.click(rect.x + 8, rect.y + rect.height - 8);
	await expect(composeBar(page)).toBeVisible();
}

/** Bounding box, in mm on a 96 dpi raster, of pixels close to `rgb`. */
async function rasterBoxMm(
	page: Page,
	png: Buffer,
	rgb: readonly [number, number, number],
): Promise<MmBox> {
	await page.setContent(
		`<img alt="PDF page" src="data:image/png;base64,${png.toString("base64")}">`,
	);
	const px = await page.getByRole("img", { name: "PDF page" }).evaluate(
		(image: HTMLImageElement, color: number[]) => {
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("no context");
			context.drawImage(image, 0, 0);
			const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (let y = 0; y < canvas.height; y++) {
				for (let x = 0; x < canvas.width; x++) {
					const i = (y * canvas.width + x) * 4;
					const distance =
						Math.abs(data[i] - color[0]) +
						Math.abs(data[i + 1] - color[1]) +
						Math.abs(data[i + 2] - color[2]);
					if (distance > 40) continue;
					minX = Math.min(minX, x);
					minY = Math.min(minY, y);
					maxX = Math.max(maxX, x);
					maxY = Math.max(maxY, y);
				}
			}
			return { minX, minY, maxX, maxY };
		},
		[...rgb],
	);
	const mm = 25.4 / 96;
	return {
		left: px.minX * mm,
		top: px.minY * mm,
		width: (px.maxX + 1 - px.minX) * mm,
		height: (px.maxY + 1 - px.minY) * mm,
	};
}

test.describe("Hand editor", () => {
	test("composes a document by hand, the agent takes it over, and the PDF keeps the geometry", async ({
		baseURL,
		browser,
		mcp,
		page,
	}, testInfo) => {
		test.setTimeout(180_000);
		const doc = "Affiche faite main";
		await page.setViewportSize({ width: 1400, height: 1000 });
		const imagePath = testInfo.outputPath("hand-hero.svg");
		await mkdir(dirname(imagePath), { recursive: true });
		await writeFile(
			imagePath,
			`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="rgb(${IMAGE_FILL.join(",")})"/></svg>`,
		);
		await mcp.call("maket_image", {
			action: "import",
			path: imagePath,
			filename: "hand-hero.svg",
		});
		await openWorkspace(page);

		// Criterion 1 — a blank document created from the Documents library.
		const library = await openLibraryView(page, "docs");
		await library
			.getByRole("button", { name: /^(New document|Nouveau document)$/ })
			.click();
		const nameInput = library.getByPlaceholder(
			/^(Name of the new document|Nom du nouveau document)$/,
		);
		await nameInput.fill(doc);
		await nameInput.press("Enter");
		await expect(library.getByText(doc, { exact: true })).toBeVisible();
		await expect(pageCanvas(page, doc)).toBeVisible();
		const listed = await mcp.callText("maket_doc", { action: "list" });
		expect(listed).toContain(`${doc} (A4 portrait`);
		let size = await pageSizeMm(pageCanvas(page, doc));
		expect(Math.round(size.w)).toBe(210);
		expect(Math.round(size.h)).toBe(297);
		await closeLibrary(page);

		// Criterion 2 — a blank page added from the canvas.
		await focusPage(page, doc);
		await composeBar(page)
			.getByRole("button", { name: /^(Add a page|Ajouter une page)$/ })
			.click();
		await expect(pageCanvas(page, doc, 1)).toBeVisible();
		expect(await mcp.callText("maket_page", { action: "list", doc })).toContain(
			"2 pages",
		);

		// Criterion 3 — format and orientation, persisted across a reload.
		await focusPage(page, doc);
		await composeBar(page)
			.getByLabel(/^Format$/)
			.selectOption("A5");
		await expect
			.poll(async () => Math.round((await pageSizeMm(pageCanvas(page, doc))).h))
			.toBe(210);
		await composeBar(page)
			.getByLabel(/^(Orientation)$/)
			.selectOption("landscape");
		await expect
			.poll(async () => {
				const current = await pageSizeMm(pageCanvas(page, doc));
				return [Math.round(current.w), Math.round(current.h)];
			})
			.toEqual([210, 148]);
		await page.reload();
		await openWorkspace(page);
		await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
		await expect(pageCanvas(page, doc)).toBeVisible();
		size = await pageSizeMm(pageCanvas(page, doc));
		expect([Math.round(size.w), Math.round(size.h)]).toEqual([210, 148]);
		expect(await mcp.callText("maket_doc", { action: "list" })).toContain(
			`${doc} (A5 landscape`,
		);

		// Criterion 4 — palette, mouse move, resize handles, delete, text edit,
		// observed in a second connected browser and after a reload.
		const second = await browser.newContext({ baseURL });
		const observer = await second.newPage();
		await observer.setViewportSize({ width: 1400, height: 1000 });
		await openWorkspace(observer);
		await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
		await expect(pageCanvas(observer, doc)).toBeVisible();

		await focusPage(page, doc);
		const bar = composeBar(page);
		await bar
			.getByRole("button", { name: /^(Add a frame|Ajouter un cadre)$/ })
			.click();
		await expect(placed(page, doc, "frame")).toHaveCount(1);
		await bar
			.getByRole("button", { name: /^(Add an image|Ajouter une image)$/ })
			.click();
		await bar.getByRole("option", { name: "hand-hero.svg" }).click();
		await expect(placed(page, doc, "image")).toHaveCount(1);
		await bar
			.getByRole("button", { name: /^(Add text|Ajouter un texte)$/ })
			.click();
		await expect(placed(page, doc, "text")).toHaveCount(1);
		for (const prefix of ["frame", "image", "text"])
			await expect(placed(observer, doc, prefix)).toHaveCount(1);

		let html = await pageHtml(mcp, doc);
		const frameId = /data-id="(frame-[0-9a-f]{8})"/.exec(html)?.[1] ?? "";
		const imageId = /data-id="(image-[0-9a-f]{8})"/.exec(html)?.[1] ?? "";
		const textId = /data-id="(text-[0-9a-f]{8})"/.exec(html)?.[1] ?? "";
		expect([frameId, imageId, textId].every(Boolean)).toBe(true);
		expect(html).toContain('src="/assets/hand-hero.svg"');
		expect(html.match(/data-maket-layout="ignore"/g)).toHaveLength(2);
		const canvas = pageCanvas(page, doc);
		const frame = canvas.locator(`[data-id="${frameId}"]`);
		const image = canvas.locator(`[data-id="${imageId}"]`);
		const text = canvas.locator(`[data-id="${textId}"]`);
		expectBox(await boxMm(canvas, frame, 210), storedBox(html, frameId));

		// Move the image 60 mm to the right with the mouse.
		const scale = await pxPerMm(canvas, 210);
		const imageBefore = storedBox(html, imageId);
		const imageRect = await image.boundingBox();
		if (!imageRect) throw new Error("image missing");
		// Grab the image by its top-left corner: the text block covers its centre.
		await dragBy(
			page,
			{ x: imageRect.x + 6, y: imageRect.y + 6 },
			60 * scale,
			0,
		);
		await expect
			.poll(async () => storedBox(await pageHtml(mcp, doc), imageId).left)
			.toBeGreaterThan(imageBefore.left + 59);
		html = await pageHtml(mcp, doc);
		expect(storedBox(html, imageId).left).toBeCloseTo(imageBefore.left + 60, 0);
		expect(html).toContain(`data-id="${imageId}"`);
		await expect
			.poll(async () =>
				Math.round(
					(
						await boxMm(
							pageCanvas(observer, doc),
							pageCanvas(observer, doc).locator(`[data-id="${imageId}"]`),
							210,
						)
					).left,
				),
			)
			.toBe(Math.round(imageBefore.left + 60));

		// Resize the frame from its bottom-right handle.
		const frameBefore = storedBox(html, frameId);
		const frameRect = await frame.boundingBox();
		if (!frameRect) throw new Error("frame missing");
		await page.mouse.click(frameRect.x + 4, frameRect.y + 4);
		const handle = canvas.locator(
			`[data-placed-selection="${frameId}"] [data-resize-handle="se"]`,
		);
		await expect(handle).toBeVisible();
		await dragBy(page, await centre(handle), 20 * scale, 10 * scale);
		await expect
			.poll(async () => storedBox(await pageHtml(mcp, doc), frameId).width)
			.toBeGreaterThan(frameBefore.width + 19);
		html = await pageHtml(mcp, doc);
		expect(storedBox(html, frameId).height).toBeCloseTo(
			frameBefore.height + 10,
			0,
		);
		expect(storedBox(html, frameId).left).toBe(frameBefore.left);

		// A temporary frame removed with the hold-to-delete action.
		await focusPage(page, doc);
		await bar
			.getByRole("button", { name: /^(Add a frame|Ajouter un cadre)$/ })
			.click();
		await expect(placed(page, doc, "frame")).toHaveCount(2);
		const extra = placed(page, doc, "frame").nth(1);
		const extraId = (await extra.getAttribute("data-id")) ?? "";
		await page.mouse.click((await centre(extra)).x, (await centre(extra)).y);
		await page.locator(".element-toolbar .tb-delete").click();
		const hold = page
			.locator(".element-toolbar")
			.getByRole("button", { name: /Hold to delete|Maintenir pour supprimer/ });
		const holdCentre = await centre(hold);
		await page.mouse.move(holdCentre.x, holdCentre.y);
		await page.mouse.down();
		await page.waitForTimeout(900);
		await page.mouse.up();
		await expect(placed(page, doc, "frame")).toHaveCount(1);
		await expect(placed(observer, doc, "frame")).toHaveCount(1);
		expect(await pageHtml(mcp, doc)).not.toContain(extraId);

		// The text block edited in place through text_edit.
		await text.click();
		await page.locator(".element-toolbar .tb-edit").click();
		await expect(text).toHaveAttribute("contenteditable", "true");
		await page.keyboard.press("ControlOrMeta+A");
		await page.keyboard.type("Fait main");
		await text.evaluate((element: HTMLElement) => element.blur());
		await expect
			.poll(async () => pageHtml(mcp, doc))
			.toContain(">Fait main</div>");
		await expect(
			pageCanvas(observer, doc).locator(`[data-id="${textId}"]`),
		).toHaveText("Fait main");

		// Everything survives a reload.
		html = await pageHtml(mcp, doc);
		await page.reload();
		await openWorkspace(page);
		await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
		await expect(text).toHaveText("Fait main");
		for (const id of [frameId, imageId, textId])
			expectBox(
				await boxMm(canvas, canvas.locator(`[data-id="${id}"]`), 210),
				storedBox(html, id),
			);

		// Criterion 5 — the agent takes over: frame moved left so the text
		// overlaps both the frame and the image.
		await mcp.call("maket_html", {
			action: "patch",
			doc,
			page: 1,
			ops: [{ id: frameId, style: { left: "20mm" } }],
		});
		await expect
			.poll(async () => Math.round((await boxMm(canvas, frame, 210)).left))
			.toBe(20);
		html = await pageHtml(mcp, doc);
		const textBox = storedBox(html, textId);
		const frameBox = storedBox(html, frameId);
		const imageBox = storedBox(html, imageId);
		const overlaps = (a: MmBox, b: MmBox) =>
			a.left < b.left + b.width &&
			b.left < a.left + a.width &&
			a.top < b.top + b.height &&
			b.top < a.top + a.height;
		expect(overlaps(textBox, frameBox)).toBe(true);
		expect(overlaps(textBox, imageBox)).toBe(true);
		const check = await mcp.callText("maket_html", {
			action: "check",
			doc,
			page: 1,
		});
		expect(check).toContain("✓");
		expect(check).not.toMatch(/overlap|⛔|⚠/i);

		const agentHtml = html
			.replace(">Fait main</div>", ">Repris par l'agent</div>")
			.replace(
				new RegExp(`(data-id="${textId}"[^>]*left:)${textBox.left}mm`),
				`$1${textBox.left + 5}mm`,
			);
		expect(agentHtml).not.toBe(html);
		await mcp.call("maket_html", {
			action: "set",
			doc,
			page: 1,
			html: agentHtml,
		});
		await expect(text).toHaveText("Repris par l'agent");
		await expect
			.poll(async () => (await boxMm(canvas, text, 210)).left)
			.toBeCloseTo(textBox.left + 5, 0);
		expect(await text.getAttribute("data-id")).toBe(textId);

		// The agent-edited block stays selectable, movable, resizable, editable.
		await page.mouse.click((await centre(text)).x, (await centre(text)).y);
		await expect(
			canvas.locator(`[data-placed-selection="${textId}"]`),
		).toBeVisible();
		await dragBy(page, await centre(text), 10 * scale, 0);
		await expect
			.poll(async () => storedBox(await pageHtml(mcp, doc), textId).left)
			.toBeGreaterThan(textBox.left + 14);
		// The block stays selected after the move; its handles follow it.
		const east = canvas.locator(
			`[data-placed-selection="${textId}"] [data-resize-handle="e"]`,
		);
		await expect(east).toBeVisible();
		await dragBy(page, await centre(east), -10 * scale, 0);
		await expect
			.poll(async () => storedBox(await pageHtml(mcp, doc), textId).width)
			.toBeLessThan(textBox.width - 9);
		// Still selected after the resize: the toolbar offers the text edit.
		await page.locator(".element-toolbar .tb-edit").click();
		await expect(text).toHaveAttribute("contenteditable", "true");
		await page.keyboard.press("ControlOrMeta+A");
		await page.keyboard.type("Après reprise");
		await text.evaluate((element: HTMLElement) => element.blur());
		await expect
			.poll(async () => pageHtml(mcp, doc))
			.toContain(">Après reprise</div>");
		html = await pageHtml(mcp, doc);
		expect(html.match(/data-maket-layout="ignore"/g)).toHaveLength(2);

		// Frame moved again by hand after the agent's patch.
		const frameAfterPatch = storedBox(html, frameId);
		await dragBy(page, await centre(frame), 5 * scale, 0);
		await expect
			.poll(async () => storedBox(await pageHtml(mcp, doc), frameId).left)
			.toBeGreaterThan(frameAfterPatch.left + 4);
		const recheck = await mcp.callText("maket_html", {
			action: "check",
			doc,
			page: 1,
		});
		expect(recheck).not.toMatch(/overlap|⛔|⚠/i);

		await page.screenshot({
			path: testInfo.outputPath("hand-editor-canvas.png"),
		});

		// Criterion 6 — the PDF keeps the format, position and size.
		html = await pageHtml(mcp, doc);
		const canvasFrame = await boxMm(canvas, frame, 210);
		const canvasImage = await boxMm(canvas, image, 210);
		const exported = await mcp.callText("maket_pdf", {
			doc,
			quality: "screen",
		});
		const pdfPath = exported.match(/^PDF exported:\s*(.+?)\s+\(/)?.[1];
		if (!pdfPath) throw new Error(`PDF path missing in ${exported}`);
		const { stdout: info } = await execFileAsync("pdfinfo", [pdfPath]);
		const pageSize = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info);
		// Chromium rounds the PDF page box to its device pixels: within 0.5 mm.
		const toMm = (points: number) => (points * 25.4) / 72;
		expect(Math.abs(toMm(Number(pageSize?.[1])) - 210)).toBeLessThan(0.5);
		expect(Math.abs(toMm(Number(pageSize?.[2])) - 148)).toBeLessThan(0.5);
		const prefix = testInfo.outputPath("hand-editor-page-1");
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
		const pdfPage = await second.newPage();
		const pdfImage = await rasterBoxMm(pdfPage, raster, IMAGE_FILL);
		const pdfFrame = await rasterBoxMm(pdfPage, raster, FRAME_BORDER);
		expectBox(pdfImage, canvasImage, 0.6);
		expectBox(pdfImage, storedBox(html, imageId), 0.6);
		expectBox(pdfFrame, canvasFrame, 0.6);
		expectBox(pdfFrame, storedBox(html, frameId), 0.6);
		await testInfo.attach("pdf-page-1", {
			body: raster,
			contentType: "image/png",
		});
		await second.close();
	});

	test("leaves AUTO through the format selector and refuses hand edits on a locked document", async ({
		baseURL,
		mcp,
		page,
	}) => {
		test.setTimeout(120_000);
		const doc = "Document hauteur auto";
		await page.setViewportSize({ width: 1400, height: 1000 });
		await mcp.call("maket_doc", {
			action: "new",
			doc,
			format: "AUTO",
			width: 180,
		});
		await openWorkspace(page);
		await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
		await expect(pageCanvas(page, doc)).toBeVisible();

		// Criterion 3 — AUTO keeps the selector, without offering AUTO.
		await focusPage(page, doc);
		const bar = composeBar(page);
		const format = bar.getByLabel(/^Format$/);
		await expect(format).toHaveValue("AUTO");
		await expect(format.locator('option[value="AUTO"]')).toHaveAttribute(
			"disabled",
			"",
		);
		await expect(
			bar.getByRole("button", { name: /^(Add text|Ajouter un texte)$/ }),
		).toHaveCount(0);
		await format.selectOption("A4");
		await expect
			.poll(async () => {
				const current = await pageSizeMm(pageCanvas(page, doc));
				return [Math.round(current.w), Math.round(current.h)];
			})
			.toEqual([210, 297]);
		await expect(
			bar.getByRole("button", { name: /^(Add text|Ajouter un texte)$/ }),
		).toBeVisible();
		await bar
			.getByRole("button", { name: /^(Add a frame|Ajouter un cadre)$/ })
			.click();
		await expect(placed(page, doc, "frame")).toHaveCount(1);
		await page.reload();
		await openWorkspace(page);
		await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
		expect(await mcp.callText("maket_doc", { action: "list" })).toContain(
			`${doc} (A4 portrait`,
		);

		// Criterion 7 — locked: no bar, WS commands and MCP edits refused.
		const html = await pageHtml(mcp, doc);
		const frameId = /data-id="(frame-[0-9a-f]{8})"/.exec(html)?.[1] ?? "";
		await mcp.call("maket_workspace", { action: "lock", doc, locked: true });
		await expect(composeBar(page)).toHaveCount(0);
		await pageCanvas(page, doc).click({ position: { x: 8, y: 8 } });
		await expect(composeBar(page)).toHaveCount(0);
		if (!baseURL) throw new Error("baseURL missing");
		await page.evaluate(
			async ({ url, docName, id }) => {
				const socket = new WebSocket(url);
				await new Promise((resolve) =>
					socket.addEventListener("open", resolve),
				);
				const box = { left: 10, top: 10, width: 30, height: 30 };
				for (const message of [
					{ type: "element_add", docName, pageIndex: 0, kind: "frame", box },
					{
						type: "element_box_set",
						docName,
						pageIndex: 0,
						elementId: id,
						box,
					},
					{ type: "element_remove", docName, pageIndex: 0, elementId: id },
					{ type: "page_add", docName },
					{
						type: "canvas_format_set",
						docName,
						format: "A5",
						orientation: "portrait",
					},
				])
					socket.send(JSON.stringify(message));
				await new Promise((resolve) => setTimeout(resolve, 500));
				socket.close();
			},
			{
				url: `${baseURL.replace(/^http/, "ws")}/ws`,
				docName: doc,
				id: frameId,
			},
		);
		expect(await pageHtml(mcp, doc)).toBe(html);
		expect(await mcp.callText("maket_page", { action: "list", doc })).toContain(
			"1 pages",
		);
		expect(await mcp.callText("maket_doc", { action: "list" })).toContain(
			`${doc} (A4 portrait`,
		);
		const refused = await mcp.callError("maket_html", {
			action: "patch",
			doc,
			page: 1,
			ops: [{ id: frameId, style: { left: "50mm" } }],
		});
		expect(refused).toContain("is locked");
		expect(await pageHtml(mcp, doc)).toBe(html);
	});
});
