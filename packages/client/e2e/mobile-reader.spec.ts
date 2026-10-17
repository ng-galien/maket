import { swipeTouch } from "./touch-gesture";
import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
for (const width of [344, 690]) {
	test(`connected Reader is permanent and touch navigation stays writable at ${width}`, async ({
		page,
		mcp,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		const doc = "TEST mobile reader";
		await createDocument(mcp, doc, {
			html: '<main data-id="body"><h1 data-id="title">TEST mobile reader</h1><p data-id="long" style="height:1800px">Read and scroll</p><a data-id="next" href="#page=2">Answer</a></main>',
		});
		await mcp.call("maket_state", {
			action: "init",
			doc,
			schema: {
				type: "object",
				properties: { reply: { type: "string", title: "Test reply" } },
			},
			data: {},
		});
		await mcp.call("maket_page", {
			action: "add",
			doc,
			name: "Answer",
			json_forms: {},
		});
		await mcp.call("maket_page", {
			action: "set_form",
			doc,
			page: 2,
			json_forms: {},
		});
		await openWorkspace(page);
		const library = await openLibraryView(page, "docs");
		await library.getByRole("searchbox").fill(doc);
		await page
			.locator("[data-library-panel]")
			.getByRole("button", { name: doc, exact: true })
			.tap();
		await expect(page.locator("[data-mobile-reader]")).toBeVisible();
		await expect(page.locator("[data-library-panel]")).toBeHidden();
		const reader = page.locator("[data-reading-workspace]");
		await expect(reader).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Reading view", exact: true }),
		).toHaveCount(0);
		const box = await reader.boundingBox();
		if (!box) throw Error("Missing reader");
		const session = await page.context().newCDPSession(page);
		await swipeTouch(
			page,
			session,
			{ x: box.x + box.width / 2, y: box.y + box.height * 0.7 },
			{ x: box.x + box.width / 2, y: box.y + box.height * 0.25 },
		);
		await expect
			.poll(() => reader.evaluate((el) => el.scrollTop))
			.toBeGreaterThan(0);
		const before = await reader
			.locator("[data-reader-zoom]")
			.evaluate((el) => Number((el as HTMLElement).style.zoom));
		const x = box.x + box.width / 2,
			y = box.y + box.height / 2;
		await session.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [
				{ x: x - 30, y },
				{ x: x + 30, y },
			],
		});
		await session.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [
				{ x: x - 60, y },
				{ x: x + 60, y },
			],
		});
		await session.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await expect
			.poll(() =>
				reader
					.locator("[data-reader-zoom]")
					.evaluate((el) => Number((el as HTMLElement).style.zoom)),
			)
			.toBeGreaterThan(before);

		const leftBefore = await reader.evaluate((el) => el.scrollLeft);
		await swipeTouch(page, session, { x, y }, { x: x - 100, y });
		await expect
			.poll(() => reader.evaluate((el) => el.scrollLeft))
			.toBeGreaterThan(leftBefore);
		await reader.getByRole("button", { name: /^Fit to view —/ }).tap();
		const field = reader.getByRole("textbox", {
			name: "Test reply",
			exact: true,
		});
		await field.fill("TEST mobile, no owner decision");
		await field.press("Tab");
		await expect
			.poll(
				async () =>
					(
						await mcp.callJson<{ current: { data: { reply: string } } }>(
							"maket_state",
							{ action: "get", doc },
						)
					).current.data.reply,
			)
			.toBe("TEST mobile, no owner decision");
		await page.screenshot({
			path: test.info().outputPath(`maket-mobile-reader-v6-${width}.png`),
		});
	});
}
