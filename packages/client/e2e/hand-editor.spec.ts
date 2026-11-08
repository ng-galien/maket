import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
	_canvas: Locator,
	element: Locator,
	pageWidthMm: number,
): Promise<MmBox> {
	return element.evaluate((element, widthMm) => {
		const canvas = element.closest(".page-canvas");
		if (!canvas) throw new Error("page missing");
		const pageRect = canvas.getBoundingClientRect();
		const rect = element.getBoundingClientRect();
		const scale = widthMm / pageRect.width;
		return {
			left: (rect.x - pageRect.x) * scale,
			top: (rect.y - pageRect.y) * scale,
			width: rect.width * scale,
			height: rect.height * scale,
		};
	}, pageWidthMm);
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
	return page.locator("[data-hand-compose-panel]");
}

async function focusPage(page: Page, doc: string, index = 0) {
	const canvas = pageCanvas(page, doc, index);
	const rect = await canvas.boundingBox();
	if (!rect) throw new Error("page missing");
	await page.mouse.click(rect.x + 8, rect.y + rect.height - 8);
	const toggle = page.locator("[data-composer-toggle]");
	if ((await toggle.getAttribute("aria-pressed")) !== "true")
		await toggle.click();
	await expect(composeBar(page)).toBeVisible();
}

/** Complete an already armed insertion using an explicit on-page gesture. */
async function placeElement(
	page: Page,
	doc: string,
	kind: "text" | "image" | "frame",
	index = 0,
) {
	const canvas = pageCanvas(page, doc, index);
	await expect(canvas).toHaveAttribute("data-hand-placement", kind);
	const size = await pageSizeMm(canvas);
	const width = kind === "text" ? 80 : 60;
	const height = kind === "text" ? 15 : 40;
	const rect = await canvas.boundingBox();
	if (!rect) throw new Error("page missing");
	const scale = rect.width / size.w;
	const start = {
		x: rect.x + (kind === "text" ? 10 : 20) * scale,
		y: rect.y + (kind === "text" ? 32.5 : 20) * scale,
	};
	if (kind === "frame")
		await dragBy(page, start, width * scale, height * scale);
	else await page.mouse.click(start.x, start.y);
	if (kind === "text") {
		const text = canvas.locator('[contenteditable="true"]');
		await expect(text).toBeFocused();
		await composeBar(page)
			.getByRole("button", { name: /Finish typing|Terminer la saisie/ })
			.click();
	}
	await expect(canvas.locator("[data-placed-selection]")).toBeVisible();
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
	test("follows added pages, confirms deletion, and remembers the full-height Composer width", async ({
		mcp,
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1400, height: 1000 });
		await mcp.call("maket_doc", {
			action: "new",
			doc: "Composer pages",
			format: "A4",
		});
		await openWorkspace(page);
		const library = await openLibraryView(page, "docs");
		await library
			.getByRole("button", { name: "Composer pages", exact: true })
			.click();
		await focusPage(page, "Composer pages");
		await closeLibrary(page);
		const panel = page.locator("[data-composer-panel]");
		const original = await panel.boundingBox();
		if (!original) throw new Error("Composer missing");
		expect(original.height).toBeGreaterThan(900);
		const resize = panel.getByRole("separator", {
			name: /Resize Composer|Redimensionner Composer/,
		});
		await resize.press("ArrowLeft");
		expect((await panel.boundingBox())?.width).toBeGreaterThan(original.width);
		await dragBy(page, await centre(resize), -48, 40);
		const resized = await panel.boundingBox();
		if (!resized) throw new Error("Composer missing");
		expect(resized.height).toBe(original.height);
		expect(resized.width).toBeGreaterThan(original.width + 48);
		await page.locator("[data-composer-toggle]").click();
		await page.locator("[data-composer-toggle]").click();
		expect((await panel.boundingBox())?.width).toBe(resized.width);
		await page.reload();
		await focusPage(page, "Composer pages");
		expect((await panel.boundingBox())?.width).toBe(resized.width);
		await dragBy(page, await centre(resize), 1000, 0);
		expect((await panel.boundingBox())?.width).toBe(240);
		await page.reload();
		await focusPage(page, "Composer pages");
		expect((await panel.boundingBox())?.width).toBe(240);
		await composeBar(page)
			.getByRole("button", { name: /Add a page|Ajouter une page/ })
			.click();
		await expect(
			composeBar(page).getByRole("combobox", { name: "Page", exact: true }),
		).toHaveText("Page 2");
		await expect
			.poll(async () => {
				const box = await pageCanvas(page, "Composer pages", 1).boundingBox();
				return box && box.x >= 0 && box.y >= 0 && box.y + box.height <= 1000;
			})
			.toBeTruthy();
		const pageSelect = composeBar(page).getByRole("combobox", {
			name: "Page",
			exact: true,
		});
		await pageSelect.click();
		await expect(
			page.getByRole("option", { name: "Page 2", exact: true }),
		).toBeFocused();
		await page.screenshot({
			path: testInfo.outputPath("composer-pages-open.png"),
		});
		await page.getByRole("option", { name: "Page 1", exact: true }).click();
		await expect(pageSelect).toHaveText("Page 1");
		await expect
			.poll(async () => {
				const box = await pageCanvas(page, "Composer pages", 0).boundingBox();
				return box && box.x >= 0 && box.y >= 0 && box.y + box.height <= 1000;
			})
			.toBeTruthy();
		await pageSelect.press("ArrowDown");
		await page
			.getByRole("option", { name: "Page 1", exact: true })
			.press("ArrowDown");
		await page
			.getByRole("option", { name: "Page 2", exact: true })
			.press("Enter");
		await expect(pageSelect).toHaveText("Page 2");
		await composeBar(page)
			.getByRole("button", { name: /^(Delete page|Supprimer la page)$/ })
			.click();
		const confirm = composeBar(page).getByRole("button", {
			name: /Hold to delete the page|Maintenir pour supprimer la page/,
		});
		const box = await confirm.boundingBox();
		if (!box) throw new Error("Confirmation missing");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await expect(
			composeBar(page).getByRole("combobox", { name: "Page", exact: true }),
		).toHaveText("Page 1");
		await page.mouse.up();
		await expect(
			composeBar(page).getByRole("button", {
				name: /^(Delete page|Supprimer la page)$/,
			}),
		).toBeDisabled();
		await expect(pageCanvas(page, "Composer pages", 1)).toHaveCount(0);
		await pageSelect.click();
		await page
			.getByRole("option", { name: "Page 1", exact: true })
			.press("Escape");
		await expect(
			page.getByRole("listbox", { name: "Page", exact: true }),
		).toHaveCount(0);
		await expect(pageSelect).toBeFocused();
		await expect(
			composeBar(page).getByRole("heading", {
				name: /Composer|Compose/,
				exact: true,
			}),
		).toHaveCount(0);
		await page.screenshot({ path: testInfo.outputPath("composer-pages.png") });
	});

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

		// Criterion 1 — exact category destination, including nested categories.
		await mcp.call("maket_doc", {
			action: "new",
			doc: "Category seed",
			category: "Exemples/Formats/Affiches",
			format: "A4",
			orientation: "portrait",
		});
		const library = await openLibraryView(page, "docs");
		await library
			.getByRole("button", {
				name: /^(New document in|Nouveau document dans) Exemples\/Formats\/Affiches$/,
			})
			.click();
		const nameInput = library.getByPlaceholder(
			/^(Name of the new document|Nom du nouveau document)$/,
		);
		await nameInput.fill(doc);
		await nameInput.press("Enter");
		await expect(library.getByText(doc, { exact: true })).toBeVisible();
		await expect(page.locator("[data-composer-toggle]")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(composeBar(page)).toBeVisible();
		const identity = await mcp.callText("maket_workspace", {
			action: "state",
			doc,
		});
		expect(identity).toContain("Exemples/Formats/Affiches");
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
			.getByRole("combobox", { name: "Format", exact: true })
			.click();
		await page.getByRole("option", { name: "A5", exact: true }).click();
		await expect
			.poll(async () => Math.round((await pageSizeMm(pageCanvas(page, doc))).h))
			.toBe(210);
		await composeBar(page)
			.getByRole("combobox", { name: "Orientation", exact: true })
			.click();
		await page
			.getByRole("option", { name: /Landscape|Paysage/, exact: true })
			.click();
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
		await placeElement(page, doc, "frame");
		await expect(placed(page, doc, "frame")).toHaveCount(1);
		await bar
			.getByRole("button", { name: /^(Add an image|Ajouter une image)$/ })
			.click();
		await page.getByRole("option", { name: "hand-hero.svg" }).click();
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await placeElement(page, doc, "image");
		await expect(placed(page, doc, "image")).toHaveCount(1);
		await bar
			.getByRole("button", { name: /^(Add text|Ajouter un texte)$/ })
			.click();
		await placeElement(page, doc, "text");
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
		await placeElement(page, doc, "frame");
		await expect(placed(page, doc, "frame")).toHaveCount(2);
		const extra = placed(page, doc, "frame").nth(1);
		const extraId = (await extra.getAttribute("data-id")) ?? "";
		await expect(
			canvas.locator(`[data-placed-selection="${extraId}"]`),
		).toBeVisible();
		await bar.getByRole("button", { name: /^(Delete|Supprimer)$/ }).click();
		const hold = page
			.locator("[data-hand-compose-panel]")
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
		await focusPage(page, doc);
		await canvas.click({ position: { x: 8, y: 8 } });
		await page.mouse.click((await centre(text)).x, (await centre(text)).y);
		await expect(
			canvas.locator(`[data-placed-selection="${textId}"]`),
		).toBeVisible();
		await bar
			.getByRole("button", { name: "Finish typing", exact: true })
			.click();
		const resumedScale = await pxPerMm(canvas, 210);
		await dragBy(page, await centre(text), 10 * resumedScale, 0);
		await expect
			.poll(async () => storedBox(await pageHtml(mcp, doc), textId).left)
			.toBeGreaterThan(textBox.left + 14);
		// The block stays selected after the move; its handles follow it.
		const east = canvas.locator(
			`[data-placed-selection="${textId}"] [data-resize-handle="e"]`,
		);
		await expect(east).toBeVisible();
		await dragBy(page, await centre(east), -10 * resumedScale, 0);
		await expect
			.poll(async () => storedBox(await pageHtml(mcp, doc), textId).width)
			.toBeLessThan(textBox.width - 9);
		// Still selected after the resize: the toolbar offers the text edit.
		await text.click();
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
		const frameGrab = await frame.boundingBox();
		if (!frameGrab) throw new Error("frame missing");
		await dragBy(
			page,
			{ x: frameGrab.x + 5, y: frameGrab.y + frameGrab.height - 5 },
			5 * resumedScale,
			0,
		);
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
		await expect(format).toHaveText("Auto height");
		await format.click();
		await expect(
			page.getByRole("option", { name: "Auto height", exact: true }),
		).toBeDisabled();
		await expect(
			bar.getByRole("button", { name: /^(Add text|Ajouter un texte)$/ }),
		).toHaveCount(0);
		await page.getByRole("option", { name: "A4", exact: true }).click();
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
		await placeElement(page, doc, "frame");
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

test("keeps Composer explicit, context-sensitive and reversible across existing documents and parent categories", async ({
	page,
	mcp,
}) => {
	await page.setViewportSize({ width: 1400, height: 1000 });
	const doc = "Mixed authored document";

	await mcp.call("maket_doc", {
		action: "new",
		doc,
		category: "Exemples/Formats/Affiches",
		format: "A4",
		orientation: "portrait",
	});
	await mcp.call("maket_html", {
		action: "set",
		doc,
		page: 1,
		html: '<main data-id="page" style="position:relative;width:100%;height:100%"><h1 data-id="agent-title">Agent title</h1><div data-id="placed-frame" data-noedit="" style="position:absolute;left:20mm;top:40mm;width:60mm;height:30mm;border:1px solid black"></div></main>',
	});
	await openWorkspace(page);
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await expect(pageCanvas(page, doc)).toBeVisible();
	await expect(composeBar(page)).toHaveCount(0);
	await closeLibrary(page);
	await expect(page.locator("[data-library-panel]")).toHaveCSS("width", "56px");
	const surface = page.locator("[data-workspace-surface]");
	const initialWidth = await surface.evaluate(
		(element) => element.getBoundingClientRect().width,
	);
	await pageCanvas(page, doc).locator('[data-id="agent-title"]').click();
	await expect(page.locator(".element-toolbar")).toHaveCount(0);
	const toggle = page.locator("[data-composer-toggle]");
	await toggle.click();
	await expect(
		composeBar(page).getByRole("button", { name: "Edit text", exact: true }),
	).toBeVisible();
	await composeBar(page).getByText("Dynamic fields", { exact: true }).click();
	await composeBar(page)
		.getByRole("combobox", { name: "Use collection placeholder", exact: true })
		.click();
	await page.getByRole("option", { name: "page.number", exact: true }).click();
	await expect.poll(() => pageHtml(mcp, doc)).toContain("{{ page.number }}");
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(composeBar(page)).toBeVisible();
	await expect
		.poll(() =>
			surface.evaluate((element) => element.getBoundingClientRect().width),
		)
		.toBeLessThan(initialWidth - 200);
	await pageCanvas(page, doc).locator('[data-id="placed-frame"]').click();
	const resize = page.getByRole("separator", {
		name: "Resize Composer",
		exact: true,
	});
	for (let step = 0; step < 5; step++) await resize.press("ArrowRight");
	const tools = composeBar(page).locator("[data-composer-tools]");
	const comment = tools.getByRole("button", { name: "Comment", exact: true });
	const remove = tools.getByRole("button", { name: "Delete", exact: true });
	await expect(comment).toHaveText("");
	await expect(remove).toHaveText("");
	const toolBox = await tools
		.getByRole("button", { name: "Add text", exact: true })
		.boundingBox();
	const commentBox = await comment.boundingBox();
	const removeBox = await remove.boundingBox();
	if (!toolBox || !commentBox || !removeBox)
		throw new Error("Selection actions missing");
	expect(commentBox.y + commentBox.height / 2).toBe(
		toolBox.y + toolBox.height / 2,
	);
	expect(removeBox.y + removeBox.height / 2).toBe(
		toolBox.y + toolBox.height / 2,
	);
	expect(commentBox.x).toBeGreaterThan(toolBox.x + toolBox.width);
	await comment.click();
	await expect(page.getByPlaceholder("Message for the agent")).toBeFocused();
	await page.keyboard.press("Escape");
	await pageCanvas(page, doc).locator('[data-id="placed-frame"]').click();
	await expect(
		composeBar(page).getByRole("button", { name: "Add a frame", exact: true }),
	).toHaveAttribute("data-selected", "true");
	await expect(
		composeBar(page).getByRole("button", { name: "Add a frame", exact: true }),
	).toHaveText("");
	await expect(composeBar(page)).not.toContainText("Choose a tool");
	await composeBar(page)
		.getByText("Position and size", { exact: true })
		.click();
	const width = composeBar(page).getByLabel("Width (mm)", { exact: true });
	await expect(
		page.getByText("Focus: Mixed authored document", { exact: true }),
	).not.toBeVisible();
	await page.screenshot({
		animations: "disabled",
		path: test.info().outputPath("composer-geometry.png"),
	});
	await width.fill("70");
	await width.press("Tab");
	await expect.poll(() => pageHtml(mcp, doc)).toContain("width:70mm");
	await pageCanvas(page, doc).locator('[data-id="agent-title"]').click();
	await expect(
		composeBar(page).getByRole("button", { name: "Add text", exact: true }),
	).toHaveAttribute("data-selected", "true");
	await expect(
		composeBar(page).getByRole("button", { name: "Add a frame", exact: true }),
	).not.toHaveAttribute("data-selected");
	await expect(
		composeBar(page).getByRole("button", {
			name: "Finish typing",
			exact: true,
		}),
	).toBeVisible();
	await expect(width).toHaveCount(0);
	await expect(
		composeBar(page).getByRole("button", { name: "Add text", exact: true }),
	).toBeVisible();
	await page.screenshot({
		animations: "disabled",
		path: test.info().outputPath("composer-text-edit.png"),
	});
	await composeBar(page)
		.getByRole("button", { name: "Finish typing", exact: true })
		.click();
	await composeBar(page).getByText("Dynamic fields", { exact: true }).click();
	await composeBar(page)
		.getByRole("combobox", { name: "Use collection placeholder", exact: true })
		.click();
	await expect(
		page.getByRole("option", { name: "page.number", exact: true }),
	).toBeVisible();
	await page
		.getByRole("option", { name: "page.number", exact: true })
		.press("Escape");
	await pageCanvas(page, doc).click({ position: { x: 8, y: 8 } });
	await expect(composeBar(page)).toBeVisible();
	await expect(page.locator("[data-composer-selection]")).toHaveCount(0);
	await expect(
		composeBar(page).getByRole("button", {
			name: "Finish typing",
			exact: true,
		}),
	).toHaveCount(0);
	await page.locator("[data-composer-toggle]").click();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(composeBar(page)).toHaveCount(0);
	await expect
		.poll(() =>
			surface.evaluate((element) => element.getBoundingClientRect().width),
		)
		.toBe(initialWidth);
	const library = await openLibraryView(page, "docs");
	await library
		.getByRole("button", {
			name: "New document in Exemples/Formats",
			exact: true,
		})
		.click();
	const input = library.getByPlaceholder("Name of the new document");
	await input.fill("Parent category creation");
	await input.press("Enter");
	await expect(composeBar(page)).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	expect(
		await mcp.callText("maket_workspace", {
			action: "state",
			doc: "Parent category creation",
		}),
	).toContain("Exemples/Formats");
	await library
		.getByRole("button", { name: `View ${doc}`, exact: true })
		.click();
	await expect(composeBar(page)).toHaveCount(0);
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await toggle.click();
	await mcp.call("maket_workspace", { action: "lock", doc, locked: true });
	await expect(composeBar(page).getByRole("status")).toContainText(
		"Document locked",
	);
	await expect(
		composeBar(page).getByRole("button", { name: "Add text", exact: true }),
	).toBeDisabled();
});

test("explains why a generated flowing page cannot be composed", async ({
	mcp,
	page,
}) => {
	const doc = "Flowing Composer guard";
	await mcp.call("maket_doc", {
		action: "new",
		doc,
		format: "A6",
		orientation: "portrait",
	});
	await mcp.call("maket_state", {
		action: "init",
		doc,
		schema: {
			type: "object",
			properties: {
				rows: {
					type: "array",
					items: {
						type: "object",
						properties: { title: { type: "string" } },
						required: ["title"],
					},
				},
			},
			required: ["rows"],
		},
		data: {
			rows: Array.from({ length: 12 }, (_, index) => ({
				title: `Row ${index + 1}`,
			})),
		},
	});
	await mcp.call("maket_html", {
		action: "set",
		doc,
		page: 1,
		html: '<main data-id="page"><ol data-id="rows" style="margin:0;padding:0">{{#state.rows}}<li style="height:30mm">{{title}}</li>{{/state.rows}}</ol></main>',
	});
	await openWorkspace(page);
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await expect(pageCanvas(page, doc, 1)).toHaveCount(1, { timeout: 20_000 });
	await expect(pageCanvas(page, doc, 1)).toBeVisible();
	await closeLibrary(page);
	await pageCanvas(page, doc, 1).click({ position: { x: 8, y: 8 } });
	await page.locator("[data-composer-toggle]").click();
	await expect(composeBar(page).getByRole("status")).toContainText(
		"Generated continuation page",
	);
	await expect(
		composeBar(page).getByRole("button", { name: "Add text", exact: true }),
	).toBeDisabled();
	await expect(page.locator("[data-placed-selection]")).toHaveCount(0);
});

test("keeps the standalone viewer free of Composer controls and placed handles", async ({
	page,
}) => {
	await page.goto("/viewer.html");
	await page.setInputFiles(
		'input[type="file"]',
		fileURLToPath(new URL("./fixtures/viewer-sample.maket", import.meta.url)),
	);
	const doc = page.locator('[data-doc="poster"]');
	await expect(doc).toBeVisible();
	await doc.getByText("Grand Cru Smoked Salmon", { exact: true }).click();
	await expect(
		page.locator(
			"[data-composer-toggle], [data-composer-panel], [data-placed-selection], .element-toolbar",
		),
	).toHaveCount(0);
});

test("arms placement without creating, types at the chosen point, and leaves other clients in consultation", async ({
	page,
	mcp,
	browser,
	baseURL,
}) => {
	const doc = "Explicit placement journey";
	await page.setViewportSize({ width: 1400, height: 1000 });
	await page.emulateMedia({ colorScheme: "dark" });
	await mcp.call("maket_doc", {
		action: "new",
		doc,
		format: "A4",
		orientation: "portrait",
	});
	await openWorkspace(page);
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await closeLibrary(page);
	await expect(page.locator("[data-library-panel]")).toHaveCSS("width", "56px");
	await page.locator("[data-composer-toggle]").click();
	const bar = composeBar(page);
	const textTool = bar.getByRole("button", { name: "Add text", exact: true });
	const initial = await pageHtml(mcp, doc);
	await textTool.click();
	await expect(textTool).toHaveAttribute("aria-pressed", "true");
	await expect(bar.getByRole("status")).toHaveCount(0);
	expect(await pageHtml(mcp, doc)).toBe(initial);
	await textTool.press("Escape");
	await expect(textTool).toHaveAttribute("aria-pressed", "false");
	expect(await pageHtml(mcp, doc)).toBe(initial);
	await textTool.click();
	await textTool.click();
	await expect(textTool).toHaveAttribute("aria-pressed", "false");
	expect(await pageHtml(mcp, doc)).toBe(initial);
	const context = await browser.newContext({ baseURL });
	const observer = await context.newPage();
	await openWorkspace(observer);
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await expect(pageCanvas(observer, doc)).toBeVisible();
	await textTool.click();
	const canvas = pageCanvas(page, doc);
	const rect = await canvas.boundingBox();
	if (!rect) throw new Error("missing canvas");
	await page.mouse.click(
		rect.x + (rect.width * 20) / 210,
		rect.y + (rect.width * 25) / 210,
	);
	const editor = canvas.locator('[contenteditable="true"]');
	await expect(editor).toBeFocused();
	await expect(canvas.locator("[data-placed-selection]")).toBeVisible();
	await expect(textTool).toHaveAttribute("aria-pressed", "false");
	await expect(bar.getByLabel("Use collection placeholder")).not.toBeVisible();
	expect(
		await editor.evaluate((element) => getComputedStyle(element).color),
	).toBe("rgb(31, 41, 55)");
	await editor.fill("Placed directly where I clicked.");
	await bar.getByRole("button", { name: "Finish typing", exact: true }).click();
	await expect
		.poll(() => pageHtml(mcp, doc))
		.toContain("Placed directly where I clicked.");
	await expect(
		pageCanvas(observer, doc).getByText("Placed directly where I clicked."),
	).toBeVisible();
	await expect(
		observer.locator('[contenteditable="true"], [data-placed-selection]'),
	).toHaveCount(0);
	const id = await placed(page, doc, "text").getAttribute("data-id");
	if (!id) throw new Error("missing placed id");
	expectBox(storedBox(await pageHtml(mcp, doc), id), {
		left: 20,
		top: 25,
		width: 80,
		height: 15,
	});
	await placed(page, doc, "text").click();
	await expect(editor).toBeFocused();
	await editor.fill("One click edits this text.");
	await canvas.click({ position: { x: 8, y: 8 } });
	await expect
		.poll(() => pageHtml(mcp, doc))
		.toContain("One click edits this text.");
	await placed(page, doc, "text").click();
	await expect(
		bar.getByRole("button", { name: "Finish typing", exact: true }),
	).toBeVisible();
	await bar.getByRole("button", { name: "Cancel", exact: true }).click();
	await bar.getByRole("button", { name: "Add an image", exact: true }).click();
	await expect(page.locator("[data-composer-image-picker]")).toBeVisible();
	await page
		.getByRole("button", { name: "Close image picker" })
		.press("Escape");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await textTool.click();
	await page.locator("[data-composer-toggle]").click();
	await page.locator("[data-composer-toggle]").click();
	await expect(textTool).toHaveAttribute("aria-pressed", "false");
	await page.screenshot({
		path: test.info().outputPath("composer-placement-dark.png"),
	});
	await context.close();
});

test("finds images in a larger library without clipping or an extra confirmation", async ({
	page,
	mcp,
}, testInfo) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1280, height: 720 });
	const imagePath = testInfo.outputPath("library-source.svg");
	await mkdir(dirname(imagePath), { recursive: true });
	await writeFile(
		imagePath,
		'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#356579"/></svg>',
	);
	for (let index = 1; index <= 65; index++)
		await mcp.call("maket_image", {
			action: "import",
			path: imagePath,
			filename:
				index === 65 ? "recherche & détail #65.svg" : `library-${index}.svg`,
			title: `Library image ${index}`,
			category: index % 2 ? "Nature/Mountains" : "Places/Cities",
			tags: index === 65 ? ["needle-tag"] : [],
		});
	const doc = "Large image picker journey";
	await mcp.call("maket_doc", {
		action: "new",
		doc,
		format: "A4",
		orientation: "portrait",
	});
	await openWorkspace(page);
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await closeLibrary(page);
	await page.locator("[data-composer-toggle]").click();
	await composeBar(page)
		.getByRole("button", { name: "Add an image", exact: true })
		.click();
	const picker = page.locator("[data-composer-image-picker]");
	const search = picker.getByLabel("Search images…", { exact: true });
	await expect(search).toBeFocused();
	await expect(picker.getByRole("listbox").getByRole("option")).toHaveCount(40);
	await expect(picker.getByRole("status")).toHaveText(
		"Showing 40 of 65 images",
	);
	const bounds = await picker.boundingBox();
	if (!bounds) throw new Error("picker missing");
	expect(bounds.x).toBeGreaterThanOrEqual(8);
	expect(bounds.y).toBeGreaterThanOrEqual(8);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280 - 8);
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(720 - 8);
	await page.screenshot({
		path: testInfo.outputPath("composer-library-65-images.png"),
	});
	await picker.getByRole("button", { name: "Show more images" }).click();
	await expect(picker.getByRole("listbox").getByRole("option")).toHaveCount(65);
	await picker.getByLabel("Image category").selectOption("Nature");
	await expect(picker.getByRole("listbox").getByRole("option")).toHaveCount(33);
	await search.fill("library-23.svg");
	await expect(picker.getByRole("listbox").getByRole("option")).toHaveCount(1);
	await expect(
		picker
			.getByRole("listbox")
			.getByRole("option", { name: "Library image 23", exact: true }),
	).toBeVisible();
	await search.fill("needle-tag");
	const chosen = picker.getByRole("listbox").getByRole("option", {
		name: "Library image 65",
		exact: true,
	});
	await expect(chosen).toBeVisible();
	await expect
		.poll(() =>
			chosen
				.locator("img")
				.evaluate(
					(image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
				),
		)
		.toBe(true);
	await chosen.click();
	await expect(picker).toHaveCount(0);
	await expect(
		composeBar(page).getByRole("button", { name: "Add an image", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await placeElement(page, doc, "image");
	await expect(placed(page, doc, "image")).toHaveCount(1);
	await composeBar(page)
		.getByRole("button", { name: "Add an image", exact: true })
		.click();
	await expect(search).toBeFocused();
	await search.press("Escape");
	await expect(picker).toHaveCount(0);
	await expect(
		composeBar(page).getByRole("button", { name: "Add an image", exact: true }),
	).toBeFocused();
});
