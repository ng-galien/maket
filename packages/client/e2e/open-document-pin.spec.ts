import {
	closeLibrary,
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test("pins open documents without changing focus and shares persisted state with the library", async ({
	page,
	mcp,
}) => {
	const alpha = "Pin menu alpha";
	const beta = "Pin menu beta";
	await openWorkspace(page);
	await createDocument(mcp, alpha);
	await createDocument(mcp, beta);
	for (const doc of [alpha, beta]) {
		await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	}
	const trigger = page
		.locator("[data-workspace-header]")
		.getByRole("button", { name: "Document", exact: true });
	await expect(trigger).toContainText(beta);
	await trigger.click();
	const menu = page.locator("[data-reader-menu]");
	const pin = menu.locator(`[data-open-document-pin="${alpha}"]`);
	await expect(pin).toHaveAttribute("aria-pressed", "false");
	await pin.click();
	await expect(pin).toHaveAttribute("aria-pressed", "true");
	await expect(pin).toHaveAttribute("title", `Unpin ${alpha}`);
	await expect(menu).toBeVisible();
	await expect(trigger).toContainText(beta);
	await expect(menu.getByRole("option")).toHaveText([
		`${alpha}Maket / general`,
		`${beta}Maket / general`,
	]);

	// A focused option tabs to its sibling pin action, which also supports Space.
	await menu.getByRole("option", { name: alpha, exact: true }).focus();
	await page.keyboard.press("Tab");
	await expect(pin).toBeFocused();
	await page.keyboard.press("Space");
	await expect(pin).toHaveAttribute("aria-pressed", "false");
	await expect(menu).toBeVisible();
	await pin.press("Enter");
	await expect(pin).toHaveAttribute("aria-pressed", "true");
	await pin.press("Escape");
	await expect(menu).toHaveCount(0);
	await expect(trigger).toBeFocused();

	const library = await openLibraryView(page, "docs");
	const libraryPin = library.locator(
		`[data-pinned-documents] [data-doc-pin="${alpha}"]`,
	);
	await expect(libraryPin).toHaveAttribute("aria-pressed", "true");
	await libraryPin.click();
	await expect(
		library.locator(`[data-pinned-documents] [data-doc-pin="${alpha}"]`),
	).toHaveCount(0);
	await closeLibrary(page);
	await trigger.click();
	await expect(pin).toHaveAttribute("aria-pressed", "false");
	await pin.click();
	await expect(pin).toHaveAttribute("aria-pressed", "true");
	await expect(trigger).toContainText(beta);
	await page.reload();
	await expect(trigger).toBeVisible();
	await trigger.click();
	await expect(pin).toHaveAttribute("aria-pressed", "true");
	await pin.click();
	await expect(pin).toHaveAttribute("aria-pressed", "false");
	await page.reload();
	await trigger.click();
	await expect(pin).toHaveAttribute("aria-pressed", "false");
	await menu
		.getByRole("button", { name: `Close ${alpha}`, exact: true })
		.click();
	await expect(
		menu.getByRole("option", { name: alpha, exact: true }),
	).toHaveCount(0);
	await expect(trigger).toContainText(beta);
});
