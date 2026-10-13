import {
	closeLibrary,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test("AUTO retains width, grows and shrinks with state, and exports each page at its content height", async ({
	mcp,
	page,
}) => {
	const doc = "Auto height refinement";
	await openWorkspace(page);
	await mcp.callError("maket_doc", {
		action: "new",
		doc: "Missing width",
		format: "AUTO",
	});
	await mcp.call("maket_doc", {
		action: "new",
		doc,
		format: "AUTO",
		width: 160,
	});
	await mcp.call("maket_state", {
		action: "init",
		doc,
		schema: {
			type: "object",
			properties: {
				answers: { type: "array", items: { type: "string" } },
				note: { type: "string" },
			},
		},
		data: { answers: ["First answer"], note: "" },
	});
	await mcp.call("maket_html", {
		action: "set",
		doc,
		page: 1,
		html: '<main data-id="page" style="padding:20px"><h1 data-id="title">Refinement</h1><ol data-id="history">{{#state.answers}}<li style="height:30px">{{ . }}</li>{{/state.answers}}</ol><section data-id="question"><!--maket-json-form--></section></main>',
	});
	await mcp.call("maket_page", {
		action: "set_form",
		doc,
		page: 1,
		json_forms: {
			uischema: {
				type: "Control",
				scope: "#/properties/note",
				options: { multi: true },
			},
		},
	});
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	const library = await openLibraryView(page, "docs");
	await library
		.getByRole("button", { name: /grid view|vue vignettes/i })
		.click();
	const card = library.getByRole("img", { name: doc, exact: true });
	await expect(card).toBeVisible();
	await expect
		.poll(() =>
			card.evaluate(
				(el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
			),
		)
		.toBe(true);
	await closeLibrary(page);
	const canvas = page.locator(`[data-doc="${doc}"] .page-canvas`);
	await expect(canvas).toHaveAttribute("data-auto-height", "true");
	const size = () =>
		canvas.evaluate((el) => ({
			width: el.clientWidth,
			height: el.clientHeight,
		}));
	const initial = await size();
	expect(initial.width).toBeCloseTo((160 * 96) / 25.4, 0);
	expect(initial.height).toBeGreaterThan(100);
	const current = () =>
		mcp.callJson<{ current: { revision: number } }>("maket_state", {
			action: "get",
			doc,
		});
	const replaceAnswers = async (answers: string[]) =>
		mcp.call("maket_state", {
			action: "patch",
			doc,
			expected_revision: (await current()).current.revision,
			patch: [{ op: "replace", path: "/answers", value: answers }],
		});
	await replaceAnswers(Array.from({ length: 50 }, (_, i) => `Answer ${i + 1}`));
	await expect(canvas.locator("li")).toHaveCount(50);
	await expect
		.poll(async () => (await size()).height)
		.toBeGreaterThan(initial.height + 1400);
	expect((await size()).width).toBe(initial.width);
	await expect(page.locator(`[data-doc="${doc}"] .page-canvas`)).toHaveCount(1);
	await replaceAnswers(["Final answer"]);
	await expect(canvas.locator("li")).toHaveCount(1);
	await expect.poll(async () => (await size()).height).toBe(initial.height);
	await mcp.callError("maket_canvas", { doc, width: 0 });
	await mcp.callError("maket_doc", {
		action: "new",
		doc: "Invalid width",
		format: "AUTO",
		width: -1,
	});
	await mcp.call("maket_canvas", { doc, background: "#fafafa" });
	expect((await size()).width).toBe(initial.width);
	await mcp.call("maket_page", {
		action: "add",
		doc,
		name: "Long page",
		html: '<main data-id="page" style="height:1200px;background:#eee">Long second page</main>',
	});
	const shot = await mcp.call("maket_preview", {
		action: "snapshot",
		doc,
		page: 2,
	});
	const image = shot.content.find((item) => item.type === "image");
	if (image?.type !== "image") throw new Error("No snapshot image");
	const png = Buffer.from(image.data, "base64");
	expect(png.readUInt32BE(16)).toBeCloseTo(initial.width, 0);
	expect(png.readUInt32BE(20)).toBe(1200);
	const pdf = await page.request.get(
		`/api/export-pdf?name=${encodeURIComponent(doc)}`,
	);
	expect(pdf.ok()).toBe(true);
	const rawPdf = (await pdf.body()).toString("latin1");
	const boxes = [
		...rawPdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g),
	].map((match) => ({ w: Number(match[1]), h: Number(match[2]) }));
	expect(boxes).toHaveLength(2);
	expect(Math.abs((boxes[0]?.w ?? 0) - (160 * 72) / 25.4)).toBeLessThan(1);
	expect(boxes[1]?.h).toBeCloseTo(900, 0);
	expect(boxes[0]?.h).toBeLessThan(400);
	const thumb = await page.request.get(
		`/api/thumb?name=${encodeURIComponent(doc)}&page=2&w=400`,
	);
	expect(thumb.ok()).toBe(true);
	const thumbnail = await thumb.body();
	expect(thumbnail.readUInt32BE(16)).toBe(800);
	expect(thumbnail.readUInt32BE(20)).toBeCloseTo(
		((1200 * 400) / initial.width) * 2,
		-1,
	);
	await page.goto(`/print?name=${encodeURIComponent(doc)}&auto_print=false`);
	await expect(page.locator("maket-render-page")).toHaveCount(2);
	await expect
		.poll(() => page.locator("#maket-auto-page-sizes").textContent())
		.toContain("@page maketAuto2");
	await page.goto("/");
	// Portable source keeps AUTO rather than a measured height.
	await mcp.call("maket_doc", {
		action: "export",
		docs: [doc],
		output: "auto-height.maket",
	});
	await mcp.call("maket_doc", {
		action: "new",
		doc: "Keep workspace",
		format: "A4",
	});
	await mcp.call("maket_doc", { action: "delete", doc });
	await mcp.call("maket_doc", { action: "import", input: "auto-height.maket" });
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await page.reload();
	await expect(canvas.first()).toHaveAttribute("data-auto-height", "true");
	await expect(canvas.first().getByRole("textbox")).toBeVisible();
	await mcp.call("maket_canvas", { doc, format: "A4" });
	await expect(canvas.first()).not.toHaveAttribute("data-auto-height", "true");
	expect(await canvas.first().evaluate((el) => el.clientHeight)).toBeCloseTo(
		(297 * 96) / 25.4,
		0,
	);
});

test("AUTO sizes long saved textarea responses and print-specific content", async ({
	mcp,
	page,
	baseURL,
}) => {
	const doc = "Auto print edge cases";
	await openWorkspace(page);
	await mcp.call("maket_doc", {
		action: "new",
		doc,
		format: "AUTO",
		width: 160,
	});
	await mcp.call("maket_state", {
		action: "init",
		doc,
		schema: { type: "object", properties: { note: { type: "string" } } },
		data: {
			note: Array.from({ length: 40 }, (_, i) => `Saved line ${i + 1}`).join(
				"\n",
			),
		},
	});
	await mcp.call("maket_html", {
		action: "set",
		doc,
		page: 1,
		html: '<main data-id="page"><section data-id="form"><!--maket-json-form--></section></main>',
	});
	await mcp.call("maket_page", {
		action: "set_form",
		doc,
		page: 1,
		json_forms: {
			uischema: {
				type: "Control",
				scope: "#/properties/note",
				options: { multi: true },
			},
		},
	});
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await page
		.getByRole("button", {
			name: /Open document state|Ouvrir l’état du document/i,
		})
		.click();
	const canvas = page.locator(`[data-doc="${doc}"] .page-canvas`);
	await expect
		.poll(() => canvas.getByRole("textbox").evaluate((el) => el.clientHeight))
		.toBeGreaterThan(600);
	const liveHeight = await canvas.evaluate((el) => el.clientHeight);
	const shot = await mcp.call("maket_preview", {
		action: "snapshot",
		doc,
		page: 1,
	});
	const image = shot.content.find((item) => item.type === "image");
	if (image?.type !== "image") throw new Error("No snapshot image");
	// Canvas clientHeight rounds to an integer; snapshots ceil fractional CSS pixels.
	expect(
		Math.abs(Buffer.from(image.data, "base64").readUInt32BE(20) - liveHeight),
	).toBeLessThanOrEqual(1);
	await mcp.call("maket_page", {
		action: "add",
		doc,
		name: "Print media",
		html: '<style>.print-sensitive{height:100px}@media print{.print-sensitive{height:1000px}}</style><main data-id="print-content" class="print-sensitive">Print-only height</main>',
	});
	const pdf = await page.request.get(
		`/api/export-pdf?name=${encodeURIComponent(doc)}`,
	);
	expect(pdf.ok()).toBe(true);
	const raw = (await pdf.body()).toString("latin1");
	const heights = [
		...raw.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+[\d.]+\s+([\d.]+)\s*\]/g),
	].map((match) => Number(match[1]));
	expect(heights).toHaveLength(2);
	expect(Math.abs((heights[0] ?? 0) - liveHeight * 0.75)).toBeLessThan(2);
	expect(Math.abs((heights[1] ?? 0) - 750)).toBeLessThan(2);
	const { printWithNativeDialog } = await import(
		"../../desktop/src/native-print"
	);
	let nativeHeight = 0;
	const outcome = await printWithNativeDialog(baseURL ?? "", doc, {
		platform: "darwin",
		createWindow: () => ({
			loadURL: async (url) => {
				await page.goto(url);
			},
			isDestroyed: () => false,
			isVisible: () => true,
			show: () => {},
			once: () => undefined,
			getParentWindow: () => ({}),
			destroy: () => {},
			webContents: {
				executeJavaScript: (code) => page.evaluate(code),
				print: (options, callback) => {
					nativeHeight = options.pageSize.height;
					callback(false, "Print job canceled");
				},
				printToPDF: async () => new Uint8Array(),
			},
		}),
		unusableDialogReason: () => null,
		markDialogPending: () => {},
		clearDialogPending: () => {},
		openPdf: async () => "",
		defer: (task) => task(),
		log: () => {},
	});
	expect(outcome).toEqual({ status: "canceled" });
	expect(nativeHeight).toBeGreaterThan(100000);
	await page.emulateMedia({ media: "print" });
	await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
	await expect
		.poll(() => page.locator("#maket-auto-page-sizes").textContent())
		.toContain("1000px");
	await page.emulateMedia({ media: "screen" });
});
