import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

for (const width of [344, 690, 1300]) {
	test(`general messages persist without the focused document at ${width}`, async ({
		page,
		mcp,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		await createDocument(mcp, "TEST general context");
		await openWorkspace(page);
		if (width < 960) {
			const docs = await openLibraryView(page, "docs");
			await docs.getByRole("searchbox").fill("TEST general context");
			await docs
				.getByRole("button", { name: "TEST general context", exact: true })
				.click();
		}
		await openLibraryView(page, "exchange");
		const panel = page.locator("#panel-exchange");
		await expect(panel).toContainText("0 pending");
		await expect(panel.locator(".lucide-message-circle")).toHaveCount(2);
		await expect(panel.locator(".lucide-message-square-text")).toHaveCount(0);
		await panel
			.getByRole("button", { name: "Write a message", exact: true })
			.click();
		const composer = page.locator(
			width < 960
				? "[data-mobile-message-composer]"
				: "[data-general-message-composer]",
		);
		await expect(composer).toContainText("General message");
		await expect(
			composer.getByRole("button", { name: "Send", exact: true }),
		).toBeDisabled();
		await composer.getByRole("textbox").fill("Cancelled temporary draft");
		await composer.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(composer).toHaveCount(0);
		await expect(panel).toContainText("0 pending");
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		await panel
			.getByRole("button", { name: "Write a message", exact: true })
			.click();
		await composer.getByRole("textbox").fill(`General note ${width}`);
		await composer
			.getByRole("button", { name: "Send", exact: true })
			.evaluate((button: HTMLButtonElement) => {
				button.click();
				button.click();
			});
		await expect(composer).toHaveCount(0);
		await expect(panel).toContainText("1 pending");
		const notes = await mcp.callJson<
			Array<{
				id: string;
				docName?: string;
				pageIndex?: number;
				elementId?: string;
				text: string;
			}>
		>("maket_workspace", { action: "list_messages" });
		expect(notes).toHaveLength(1);
		expect(notes[0]).toMatchObject({ text: `General note ${width}` });
		expect(notes[0].docName).toBeUndefined();
		expect(notes[0].pageIndex).toBeUndefined();
		expect(notes[0].elementId).toBeUndefined();
		expect(
			await mcp.callText("maket_workspace", {
				action: "list_messages",
				doc: "TEST general context",
			}),
		).toBe("No pending messages");
		await expect(
			panel.getByRole("button", { name: "Open target", exact: true }),
		).toHaveCount(0);
		await page.reload();
		await openLibraryView(page, "exchange");
		await expect(panel).toContainText(`General note ${width}`);
		await mcp.call("maket_workspace", {
			action: "ack_messages",
			ids: [notes[0].id],
		});
		await expect(panel).toContainText("0 pending");
	});
}
