import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.use({ isMobile: true, hasTouch: true });
for (const width of [344, 690]) {
	test(`shared document actions keep their target at ${width}`, async ({
		page,
		mcp,
	}) => {
		test.setTimeout(60000);
		await page.setViewportSize({ width, height: 800 });
		await page.addInitScript(() =>
			Object.defineProperty(navigator, "clipboard", {
				value: {
					writeText: async (text: string) => {
						document.documentElement.dataset.copiedText = text;
					},
				},
				configurable: true,
			}),
		);
		for (const name of [
			"TEST Actions A",
			"TEST Actions B",
			"TEST Actions Locked",
		])
			await createDocument(mcp, name);
		await mcp.call("maket_workspace", {
			action: "lock",
			doc: "TEST Actions Locked",
			locked: true,
		});
		await openWorkspace(page);
		const library = await openLibraryView(page, "docs");
		await library.getByRole("searchbox").fill("TEST Actions");
		const actions = (name: string) =>
			page.getByRole("dialog", {
				name: `Document actions: ${name}`,
				exact: true,
			});
		const openMenu = async (name: string, reader = false) => {
			await page
				.locator(
					reader ? "[data-mobile-simple-header]" : "[data-mobile-explorer]",
				)
				.getByRole("button", { name: `Document actions: ${name}`, exact: true })
				.click();
			await expect(actions(name)).toHaveCount(1);
		};
		await openMenu("TEST Actions A");
		for (const label of [
			"Copy title and link",
			"Write a message",
			"Share",
			"Rename",
		])
			await expect(
				actions("TEST Actions A").getByRole("button", {
					name: label,
					exact: true,
				}),
			).toBeVisible();
		await actions("TEST Actions A")
			.getByRole("button", { name: "Copy title and link", exact: true })
			.click();
		const lookup = await mcp.callJson<{ id: string }>("maket_doc", {
			action: "lookup",
			doc: "TEST Actions A",
		});
		await expect(page.locator("html")).toHaveAttribute(
			"data-copied-text",
			new RegExp(`TEST Actions A\\n.*documents/${lookup.id}/read`),
		);
		await actions("TEST Actions A")
			.getByRole("button", { name: "Write a message", exact: true })
			.click();
		const note = page.locator("[data-mobile-message-composer]");
		await expect(note.getByRole("heading")).toHaveText("TEST Actions A");
		await note.getByRole("textbox").fill("Temporary whole-document note");
		await note.getByRole("button", { name: "Send", exact: true }).click();
		await expect(note).toHaveCount(0);
		const notes = await mcp.callJson<
			Array<{ docName: string; pageIndex?: number; elementId?: string }>
		>("maket_workspace", { action: "list_messages", doc: "TEST Actions A" });
		expect(notes).toHaveLength(1);
		expect(notes[0].docName).toBe("TEST Actions A");
		expect(notes[0].pageIndex).toBeUndefined();
		expect(notes[0].elementId).toBeUndefined();
		await library
			.getByRole("button", { name: "TEST Actions A", exact: true })
			.click();
		await openMenu("TEST Actions A", true);
		for (const label of [
			"Copy title and link",
			"Write a message",
			"Share",
			"Rename",
		])
			await expect(
				actions("TEST Actions A").getByRole("button", {
					name: label,
					exact: true,
				}),
			).toBeVisible();
		await actions("TEST Actions A")
			.getByRole("button", { name: "Rename", exact: true })
			.click();
		const rename = page.locator("[data-mobile-document-rename]");
		await expect(
			rename.getByRole("button", { name: "Save", exact: true }),
		).toBeDisabled();
		await rename.getByRole("textbox").fill("TEST Actions B");
		await rename.getByRole("button", { name: "Save", exact: true }).click();
		await expect(rename.getByRole("alert")).toContainText("already exists");
		await rename.getByRole("textbox").fill("TEST Actions Renamed");
		await rename.getByRole("button", { name: "Save", exact: true }).click();
		await expect(rename).toHaveCount(0);
		await expect(page.locator("[data-mobile-simple-header]")).toContainText(
			"TEST Actions Renamed",
		);
		await page.reload();
		await expect(page.locator("[data-mobile-simple-header]")).toContainText(
			"TEST Actions Renamed",
		);
		expect(
			(
				await mcp.callJson<{ id: string }>("maket_doc", {
					action: "lookup",
					doc: "TEST Actions Renamed",
				})
			).id,
		).toBe(lookup.id);
		await page
			.locator("[data-mobile-reading-navigation]")
			.getByRole("button", { name: "Documents", exact: true })
			.click();
		await library.getByRole("searchbox").fill("TEST Actions Locked");
		await openMenu("TEST Actions Locked");
		await expect(
			actions("TEST Actions Locked").getByRole("button", {
				name: "Rename",
				exact: true,
			}),
		).toHaveCount(0);
		await expect(actions("TEST Actions Locked")).not.toContainText("read-only");
	});
}
