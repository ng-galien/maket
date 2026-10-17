import { createDocument, expect, openWorkspace, test } from "./workspace-test";

test("cancelled desktop drafts never move to another annotation target", async ({
	page,
	mcp,
}) => {
	await page.setViewportSize({ width: 1300, height: 900 });
	const doc = "TEST annotation draft scope";
	await createDocument(mcp, doc, {
		html: '<main style="padding:20mm"><h1 data-id="a">First target</h1><h2 data-id="b">Second target</h2></main>',
	});
	await openWorkspace(page);
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	const field = page.getByPlaceholder("Message for the agent");
	const open = async (id: string) => {
		await page.locator(`[data-doc="${doc}"] [data-id="${id}"]`).click();
		await page.locator(".tb-comment").click();
		await expect(field).toBeVisible();
	};
	await open("a");
	await field.fill("Draft only for the first target");
	await page.keyboard.press("Escape");
	await open("a");
	await expect(field).toHaveValue("");
	await field.fill("Another cancelled draft for the first target");
	await page.keyboard.press("Escape");
	await open("b");
	await expect(field).toHaveValue("");
	await field.fill("Message for the second target");
	await page.keyboard.press("Enter");
	const messages = () =>
		mcp.callJson<Array<{ docName: string; elementId: string; text: string }>>(
			"maket_workspace",
			{ action: "list_messages", doc },
		);
	await expect.poll(async () => (await messages()).length).toBe(1);
	expect(await messages()).toMatchObject([
		{ docName: doc, elementId: "b", text: "Message for the second target" },
	]);
});
