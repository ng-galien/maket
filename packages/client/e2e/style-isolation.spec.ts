import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test("document styles cannot reorder library chevrons after loading or updating a page", async ({
	mcp,
	page,
}) => {
	const name = "Style isolation";
	const authored = (color: string) =>
		`<style>.flex { flex-direction: row-reverse !important; } .proof { color: ${color}; }</style><main data-id="main"><span class="proof" data-id="proof">Authored styles</span></main>`;
	await createDocument(mcp, name, {
		category: "Isolation",
		html: authored("rgb(255, 0, 0)"),
	});
	await openWorkspace(page);
	await mcp.call("maket_workspace", { action: "focus", doc: name, page: 1 });
	await openLibraryView(page, "docs");
	const row = page.locator('[data-category-path="Isolation"]');
	const chevron = row.locator("[data-category-chevron]");
	const label = row.locator("[data-category-label]");
	await expect(row).toBeVisible();
	const assertChevron = async () => {
		const arrow = await chevron.boundingBox();
		const title = await label.boundingBox();
		if (!arrow || !title) throw new Error("Category geometry is unavailable");
		expect(arrow.x + arrow.width).toBeLessThanOrEqual(title.x);
	};
	await expect(page.locator('[data-id="proof"]')).toHaveCSS(
		"color",
		"rgb(255, 0, 0)",
	);
	await assertChevron();
	await mcp.call("maket_html", {
		action: "set",
		doc: name,
		page: 1,
		html: authored("rgb(0, 0, 255)"),
	});
	await expect(page.locator('[data-id="proof"]')).toHaveCSS(
		"color",
		"rgb(0, 0, 255)",
	);
	await assertChevron();
	await row.getByRole("button", { expanded: true }).click();
	await assertChevron();
});
