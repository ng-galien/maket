import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.use({
	isMobile: true,
	hasTouch: true,
	deviceScaleFactor: 2.625,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-F956B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
});

for (const [width, height] of [
	[344, 600],
	[690, 500],
]) {
	test(`classic document and reader menu use the mobile viewport ${width}x${height}`, async ({
		page,
		mcp,
	}) => {
		await page.setViewportSize({ width, height });
		await createDocument(mcp, "Classic mobile consultation document", {
			html: '<main data-id="page"><h1 data-id="title">Classic mobile consultation document</h1><p data-id="text" style="height:1200px">Read the document</p></main>',
		});
		await openWorkspace(page);
		await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
			"content",
			/interactive-widget=resizes-content/,
		);
		await expect
			.poll(async () => (await page.locator("#root").boundingBox())?.height)
			.toBe(height);
		const library = await openLibraryView(page, "docs");
		await library
			.getByRole("searchbox")
			.fill("Classic mobile consultation document");
		await library
			.getByRole("button", {
				name: "Classic mobile consultation document",
				exact: true,
			})
			.tap();
		await expect(library).toBeHidden();
		const header = page.locator("[data-mobile-simple-header]");
		await header
			.getByRole("button", {
				name: "Document actions: Classic mobile consultation document",
				exact: true,
			})
			.tap();
		const menu = page.getByRole("dialog", {
			name: "Document actions: Classic mobile consultation document",
			exact: true,
		});
		for (const [w, h] of [
			[width, height],
			[width, 320],
		]) {
			await page.setViewportSize({ width: w, height: h });
			await expect(menu).toBeVisible();
			const box = await menu.boundingBox();
			if (!box) throw new Error("Missing menu bounds");
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
			expect(box.y + box.height).toBeLessThanOrEqual(h + 1);
			for (const label of [
				"Copy title and link",
				"Write a message",
				"Share",
				"Rename",
			]) {
				const action = menu.getByRole("button", { name: label, exact: true });
				await action.scrollIntoViewIfNeeded();
				await expect(action).toBeInViewport();
			}
		}
		await menu.getByRole("button", { name: "Close", exact: true }).tap();
		await expect(menu).toHaveCount(0);
		await expect(header).toBeVisible();
	});
}

test("installation check reports a real failed resource, then recovers without inventing an install prompt", async ({
	page,
}) => {
	await page.setViewportSize({ width: 344, height: 600 });
	await openWorkspace(page);
	await page.getByRole("button", { name: "Settings", exact: true }).tap();
	await page.route("**/manifest.webmanifest", (route) =>
		route.fulfill({ status: 503, body: "Unavailable" }),
	);
	const check = page.getByRole("button", {
		name: "Check installation",
		exact: true,
	});
	await check.scrollIntoViewIfNeeded();
	await check.tap();
	await expect(page.getByRole("alert")).toContainText("Manifest HTTP 503");
	await page.unroute("**/manifest.webmanifest");
	await check.tap();
	await expect(page.locator("[data-pwa-check-result]")).toContainText(
		"does not create a shortcut or force installation",
	);
	await expect(
		page.getByRole("button", { name: "Install", exact: true }),
	).toHaveCount(0);
});
