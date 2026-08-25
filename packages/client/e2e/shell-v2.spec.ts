import { expect, openLibraryView, openWorkspace, test } from "./workspace-test";

test.describe("Maket V2 shared shell", () => {
	test("uses one global title bar above the library and canvas", async ({
		page,
	}) => {
		await openWorkspace(page);
		const header = page.locator("[data-workspace-header]");
		const workarea = page.locator("[data-shell-workarea]");
		const library = page.locator("[data-library-panel]");
		await expect(header).toBeVisible();
		await expect(workarea).toBeVisible();
		await expect(library).toBeVisible();
		const documentsIcon = library.locator('[data-library-rail-view="docs"]');
		await documentsIcon.hover();
		await expect(
			page.getByRole("tooltip", { name: /^(documents)$/i }),
		).toBeVisible();

		const headerBox = await header.boundingBox();
		const workareaBox = await workarea.boundingBox();
		const libraryBox = await library.boundingBox();
		expect(headerBox?.y).toBe(0);
		expect(workareaBox?.y).toBe(headerBox?.height);
		expect(libraryBox?.y).toBe(workareaBox?.y);
	});

	test("moves every feature into one left navigation and collapses it with Escape", async ({
		page,
	}) => {
		await openWorkspace(page);
		await openLibraryView(page, "photos");
		const exchanges = page.getByRole("button", {
			name: /^(exchanges|échanges)$/i,
		});
		await exchanges.click();

		const library = page.locator("[data-library-panel]");
		await expect(library).toHaveAttribute("data-library-view", "exchange");
		await expect(library.locator("#panel-exchange")).toBeVisible();
		await expect(page.locator("[data-utility-rail]")).toHaveCount(0);

		await page.keyboard.press("Escape");
		await expect(page.locator("#panel-exchange")).toHaveCount(0);
		await expect(library).toHaveAttribute("data-library-mode", "compact");
		await expect(page.locator("[data-canvas-workspace]")).toBeFocused();
	});

	test("uses one toolbar frame above every scrollable library view", async ({
		page,
	}) => {
		await openWorkspace(page);
		const library = await openLibraryView(page, "photos");
		const content = library.locator("[data-library-content]");
		await expect(content).toHaveCSS("overflow-y", "hidden");
		const toolbar = library.locator("[data-library-toolbar]");
		const searchInput = library.locator("[data-library-search] input");
		await expect(toolbar).toHaveCount(1);
		await expect(library.locator("[data-library-toolbar-row]")).toHaveCount(1);
		await expect(library.locator("[data-library-search]")).toHaveCount(1);
		await expect(library.locator("[data-library-toolbar-actions]")).toHaveCount(
			1,
		);
		const toolbarBox = await toolbar.boundingBox();
		const photosSearchBox = await searchInput.boundingBox();
		expect(photosSearchBox).not.toBeNull();
		const expectSearchAligned = async () => {
			await expect(searchInput).toBeVisible();
			const currentBox = await searchInput.boundingBox();
			expect(currentBox).not.toBeNull();
			expect(currentBox?.x).toBeCloseTo(photosSearchBox?.x ?? 0, 0);
			expect(currentBox?.y).toBeCloseTo(photosSearchBox?.y ?? 0, 0);
			expect(currentBox?.height).toBeCloseTo(photosSearchBox?.height ?? 0, 0);
			return currentBox;
		};
		const photosScroll = library.locator("[data-photos-scroll]");
		await expect(photosScroll).toHaveCSS("overflow-y", "auto");
		await photosScroll.evaluate((element) => {
			element.style.paddingBottom = "1400px";
			element.scrollTop = 500;
		});
		await expect
			.poll(() => photosScroll.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(0);
		expect((await toolbar.boundingBox())?.y).toBeCloseTo(toolbarBox?.y ?? 0, 0);

		await page.getByRole("button", { name: /^(brand|chartes)$/i }).click();
		await expect(toolbar).toHaveCount(1);
		await expect(library.locator("[data-library-toolbar-row]")).toHaveCount(1);
		await expect(library.locator("[data-library-search]")).toHaveCount(1);
		await expectSearchAligned();
		expect((await toolbar.boundingBox())?.height).toBeCloseTo(
			toolbarBox?.height ?? 0,
			0,
		);
		const chartesScroll = library.locator("[data-chartes-scroll]");
		await expect(chartesScroll).toHaveCSS("overflow-y", "auto");
		await chartesScroll.evaluate((element) => {
			element.style.paddingBottom = "1400px";
			element.scrollTop = 500;
		});
		await expect
			.poll(() => chartesScroll.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(0);
		expect((await toolbar.boundingBox())?.y).toBeCloseTo(toolbarBox?.y ?? 0, 0);

		await page.getByRole("button", { name: /^(documents)$/i }).click();
		await expect(toolbar).toHaveCount(1);
		await expect(library.locator("[data-library-toolbar-row]")).toHaveCount(1);
		await expect(library.locator("[data-library-search]")).toHaveCount(1);
		const documentsSearchBox = await expectSearchAligned();
		expect(documentsSearchBox?.width).toBeLessThan(photosSearchBox?.width ?? 0);
		expect((await toolbar.boundingBox())?.height).toBeCloseTo(
			toolbarBox?.height ?? 0,
			0,
		);
		await expect(library.locator("[data-documents-scroll]")).toHaveCSS(
			"overflow-y",
			"auto",
		);

		await page.getByRole("button", { name: /^(collections)$/i }).click();
		await expect(toolbar).toHaveCount(1);
		await expect(library.locator("[data-library-toolbar-row]")).toHaveCount(1);
		await expect(library.locator("[data-library-search]")).toHaveCount(1);
		await expectSearchAligned();
		expect((await toolbar.boundingBox())?.height).toBeCloseTo(
			toolbarBox?.height ?? 0,
			0,
		);

		await page.getByRole("button", { name: /^(exchanges|échanges)$/i }).click();
		await expect(toolbar).toHaveCount(1);
		await expect(library.locator("[data-library-toolbar-row]")).toHaveCount(1);
		await expect(library.locator("[data-library-search]")).toHaveCount(1);
		await expectSearchAligned();
		expect((await toolbar.boundingBox())?.height).toBeCloseTo(
			toolbarBox?.height ?? 0,
			0,
		);
		await expect(library.locator("[data-messages-scroll]")).toHaveCSS(
			"overflow-y",
			"auto",
		);
	});

	test("uses the same icon rail and content drawer below 960 pixels", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 820, height: 740 });
		await openWorkspace(page);
		const library = await openLibraryView(page, "docs");
		const resizeHandle = library.getByRole("separator", {
			name: /Resize library panel|Redimensionner le panneau de bibliothèque/i,
		});
		await expect(resizeHandle).toBeVisible();
		const panelBeforeResize = await library.boundingBox();
		const handleBox = await resizeHandle.boundingBox();
		expect(panelBeforeResize).not.toBeNull();
		expect(handleBox).not.toBeNull();
		if (!panelBeforeResize || !handleBox) return;
		await page.mouse.move(
			handleBox.x + handleBox.width / 2,
			handleBox.y + handleBox.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(handleBox.x + handleBox.width / 2 + 80, handleBox.y, {
			steps: 2,
		});
		await expect(library).toHaveAttribute("data-resizing", "true");
		await expect(library).toHaveCSS("transition-property", "none");
		const panelDuringResize = await library.boundingBox();
		expect(panelDuringResize?.width).toBeGreaterThan(
			panelBeforeResize.width + 60,
		);
		await page.mouse.up();
		await expect(library).not.toHaveAttribute("data-resizing");

		await page.getByRole("button", { name: /^(exchanges|échanges)$/i }).click();
		await expect(page.locator("#panel-exchange")).toBeVisible();
		await expect(page.locator("[data-library-panel]")).toHaveAttribute(
			"data-library-mode",
			"extended",
		);

		await page.getByRole("button", { name: /^(exchanges|échanges)$/i }).click();
		await expect(page.locator("#panel-exchange")).toHaveCount(0);
		await expect(page.locator("[data-library-panel]")).toHaveAttribute(
			"data-library-mode",
			"compact",
		);
	});
});
