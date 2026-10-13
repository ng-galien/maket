import { createDocument, expect, openWorkspace, test } from "./workspace-test";

test("returns from a multi-page free document Reader to its original page", async ({
	mcp,
	page,
}) => {
	const docName = "Reader page titles";
	await openWorkspace(page);
	await createDocument(mcp, docName);
	await mcp.call("maket_page", {
		action: "rename",
		doc: docName,
		page: 1,
		name: "Overview",
	});
	await mcp.call("maket_page", {
		action: "add",
		doc: docName,
		name: "Decisions",
		html: '<main data-id="decisions"><h2 data-id="heading">Decisions to make</h2></main>',
	});
	await mcp.call("maket_workspace", { action: "focus", doc: docName, page: 2 });
	const canvas = page.locator(`[data-doc="${docName}"]`);
	await expect(canvas.locator('[data-page-view="1"]')).toHaveAttribute(
		"data-active-page",
		"true",
	);
	await page.getByRole("button", { name: "Reading view", exact: true }).click();
	const reader = page.locator("[data-reading-workspace]");
	await expect(reader.locator("[data-reader-page-title]")).toHaveText([
		"Overview",
		"Decisions",
	]);
	const bar = page.getByRole("navigation", { name: "Reader navigation" });
	await expect(bar.getByRole("status")).toContainText("2/2");
	await bar.getByRole("button", { name: /^Previous page/ }).click();
	await expect(bar.getByRole("status")).toContainText("1/2");
	await bar.getByRole("button", { name: "Close reader", exact: true }).click();
	await expect(reader).toHaveCount(0);
	await expect(canvas.locator('[data-page-view="1"]')).toHaveAttribute(
		"data-active-page",
		"true",
	);
});
