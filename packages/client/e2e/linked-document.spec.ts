import { createDocument, expect, openWorkspace, test } from "./workspace-test";

test("opens a document-only phone reader without moving the Mac workspace", async ({
	mcp,
	page,
}) => {
	await openWorkspace(page);
	await createDocument(mcp, "Mac document");
	await createDocument(mcp, "Phone document", {
		html: '<main data-id="page"><h1 data-id="title">Phone reading content</h1></main>',
	});
	await mcp.call("maket_page", {
		action: "add",
		doc: "Phone document",
		name: "Second page",
		html: '<main data-id="second"><h1 data-id="second-title">More to read</h1></main>',
	});
	await mcp.call("maket_workspace", {
		action: "focus",
		doc: "Mac document",
		page: 1,
	});
	await expect(page.locator('[data-doc="Mac document"]')).toBeVisible();
	const link = JSON.parse(
		await mcp.callText("maket_doc", { action: "link", doc: "Phone document" }),
	) as { documentId: string; path: string };
	const phone = await page.context().newPage();
	await phone.setViewportSize({ width: 412, height: 915 });
	try {
		await phone.goto(link.path);
		expect(new URL(phone.url()).pathname).toBe(link.path.split("?")[0]);
		await expect(
			phone.locator(`[data-linked-document="${link.documentId}"]`),
		).toBeVisible();
		await expect(phone.getByText("Phone reading content")).toBeVisible();
		const headerBottom = await phone
			.locator("[data-linked-document] header")
			.evaluate((element) => element.getBoundingClientRect().bottom);
		const contentTop = await phone
			.getByRole("heading", { name: "Phone reading content" })
			.evaluate((element) => element.getBoundingClientRect().top);
		expect(contentTop).toBeGreaterThan(headerBottom);
		await expect(phone.getByRole("button", { name: /zoom in/i })).toBeVisible();
		const zoom = phone.locator("[data-reader-zoom]");
		const initialZoom = await zoom.evaluate((element) =>
			Number.parseFloat(element.style.zoom),
		);
		await phone.getByRole("button", { name: /zoom in/i }).click();
		await expect
			.poll(() =>
				zoom.evaluate((element) => Number.parseFloat(element.style.zoom)),
			)
			.toBeGreaterThan(initialZoom);
		await phone.getByRole("button", { name: /next page/i }).click();
		await expect(phone.getByText("2/2")).toBeVisible();
		await mcp.call("maket_html", {
			action: "set",
			doc: "Phone document",
			page: 2,
			html: '<main data-id="second"><h1 data-id="second-title">Updated for phone</h1></main>',
		});
		await expect(phone.getByText("Updated for phone")).toBeVisible();
		await expect(phone.locator("[data-library-panel]")).toHaveCount(0);
		await expect(page.locator('[data-doc="Mac document"]')).toBeVisible();
	} finally {
		await phone.close();
	}
});
