import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Locator, Page } from "@playwright/test";
import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

const PNG_1PX = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

test("a rejected image request stays actionable and reports the failure", async ({
	mcp,
	page,
}) => {
	const docName = `photo-request-e2e-${Date.now()}`;
	const filename = `${docName}.png`;

	try {
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A4",
			orientation: "portrait",
		});
		await page.addInitScript(() => {
			const NativeWebSocket = window.WebSocket;
			class TrackedWebSocket extends NativeWebSocket {
				constructor(url: string | URL, protocols?: string | string[]) {
					super(url, protocols ?? []);
					(
						window as typeof window & { __maketTestSocket?: WebSocket }
					).__maketTestSocket = this;
				}
			}
			Object.defineProperty(window, "WebSocket", { value: TrackedWebSocket });
		});
		await page.goto("/");
		await expect(page.locator(".animate-pulse.bg-danger")).toHaveCount(0);
		const upload = await page.evaluate(
			async ({ filename, data }) => {
				const bytes = Uint8Array.from(atob(data), (character) =>
					character.charCodeAt(0),
				);
				const form = new FormData();
				form.append("file", new File([bytes], filename, { type: "image/png" }));
				const response = await fetch("/api/upload", {
					method: "POST",
					body: form,
				});
				return {
					ok: response.ok,
					status: response.status,
					text: await response.text(),
				};
			},
			{ filename, data: PNG_1PX.toString("base64") },
		);
		if (!upload.ok) {
			throw new Error(`Asset upload failed (${upload.status}): ${upload.text}`);
		}
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});
		await expect(page.locator(`[data-doc="${docName}"]`)).toBeVisible();

		await openLibraryView(page, "photos");
		await page.getByRole("button", { name: filename }).click();
		const detailImage = page.getByRole("img", { name: filename });
		await expect
			.poll(() =>
				detailImage.evaluate(
					(image) =>
						(image as HTMLImageElement).complete &&
						(image as HTMLImageElement).naturalWidth > 0,
				),
			)
			.toBe(true);
		const insert = page.getByRole("button", {
			name: /ask the agent to add this image|demander à l’agent d’ajouter cette image/i,
		});
		await expect(insert).toBeVisible();

		await page.evaluate(() => {
			(
				window as typeof window & { __maketTestSocket?: WebSocket }
			).__maketTestSocket?.close();
		});
		await insert.click();

		await expect(page.getByRole("alert")).toContainText(
			/note could not be saved|impossible d’enregistrer la note/i,
		);
		await expect(insert).toBeVisible();
		await expect(detailImage).toBeVisible();
	} finally {
		await mcp
			.call("maket_image", { action: "delete", filename })
			.catch(() => undefined);
		await mcp
			.call("maket_doc", { action: "delete", doc: docName })
			.catch(() => undefined);
	}
});

test("uploads an asset in the UI and lets the agent use it in the document", async ({
	mcp,
	page,
}) => {
	const docName = "Agent asset workflow";
	const filename = "agent-upload.png";
	const title = "Agent uploaded pixel";
	await createDocument(mcp, docName, {
		html: [
			'<main data-id="page" style="width:210mm;height:297mm;padding:20mm">',
			'<h1 data-id="title">Asset workflow</h1>',
			'<div data-id="image-slot">Waiting for an asset</div>',
			"</main>",
		].join(""),
	});
	await openWorkspace(page);
	await mcp.call("maket_workspace", {
		action: "focus",
		doc: docName,
		page: 1,
	});
	const photos = await openLibraryView(page, "photos");
	await photos.locator('input[type="file"]').setInputFiles({
		name: filename,
		mimeType: "image/png",
		buffer: PNG_1PX,
	});
	await expect(photos.getByRole("img", { name: filename })).toBeVisible();

	const classification = await waitForMessageText(mcp, filename);
	expect(classification).toContainEqual(
		expect.objectContaining({ type: "classify-images" }),
	);
	const viewed = await mcp.call("maket_image", {
		action: "view",
		filename,
	});
	const contextToken = textContent(viewed).match(/context_token:\s*(\S+)/)?.[1];
	expect(contextToken).toBeTruthy();
	await mcp.call("maket_image", {
		action: "meta",
		filename,
		context_token: contextToken,
		title,
		description: "Uploaded by the human and prepared by the agent",
		category: "product",
		tags: ["agent", "e2e"],
	});
	await expect(photos.getByRole("img", { name: title })).toBeVisible();

	await photos.getByRole("img", { name: title }).click();
	const insert = page.getByRole("button", {
		name: /ask the agent to add this image|demander à l’agent d’ajouter cette image/i,
	});
	await expect(insert).toBeVisible();
	await insert.click();
	const requests = await waitForMessageText(mcp, `"file": "${filename}"`);
	expect(requests).toContainEqual(
		expect.objectContaining({ type: "drop-image", file: filename }),
	);

	await mcp.call("maket_html", {
		action: "patch",
		doc: docName,
		page: 1,
		ops: [
			{
				id: "image-slot",
				replace: `<img data-id="hero-image" alt="${title}" src="${filename}" style="width:32mm;height:32mm">`,
			},
		],
	});
	await mcp.call("maket_workspace", {
		action: "ack_messages",
		ids: [...classification, ...requests].map((message) => message.id),
	});

	const inserted = page.locator(`[data-doc="${docName}"]`).getByRole("img", {
		name: title,
	});
	await expect(inserted).toBeVisible();
	await expect
		.poll(() =>
			inserted.evaluate((image: HTMLImageElement) => image.naturalWidth),
		)
		.toBeGreaterThan(0);
	await expect(page.getByText("Waiting for an asset")).toHaveCount(0);
	const html = await mcp.callText("maket_html", {
		action: "get",
		doc: docName,
		page: 1,
	});
	expect(html).toContain(`/assets/${filename}`);
});

test("deletes an uploaded asset through the hold control in every open window", async ({
	mcp,
	page,
}) => {
	const filename = "shared-delete.png";
	await openWorkspace(page);
	const firstLibrary = await openLibraryView(page, "photos");
	await firstLibrary.locator('input[type="file"]').setInputFiles({
		name: filename,
		mimeType: "image/png",
		buffer: PNG_1PX,
	});
	await expect(firstLibrary.getByRole("img", { name: filename })).toBeVisible();

	const secondPage = await page.context().newPage();
	await openWorkspace(secondPage);
	const secondLibrary = await openLibraryView(secondPage, "photos");
	await expect(
		secondLibrary.getByRole("img", { name: filename }),
	).toBeVisible();

	await secondLibrary.getByRole("img", { name: filename }).click();
	await secondLibrary
		.getByRole("button", { name: /delete|supprimer/i })
		.click();
	const hold = secondLibrary.getByRole("button", {
		name: /hold to delete|maintenir pour supprimer/i,
	});
	await pressFor(secondPage, hold, 1_000);

	await expect
		.poll(() => mcp.callText("maket_image", { action: "list" }))
		.not.toContain(filename);
	await expect(firstLibrary.getByRole("img", { name: filename })).toHaveCount(
		0,
	);
	await expect(secondLibrary.getByRole("img", { name: filename })).toHaveCount(
		0,
	);
	await expect(
		mcp.callError("maket_image", { action: "view", filename }),
	).resolves.toMatch(/not found/i);
});

interface AgentMessage {
	id: string;
	type?: string;
	file?: string;
	text?: string;
}

async function waitForMessageText(
	mcp: import("./mcp-test-client").McpTestClient,
	text: string,
): Promise<AgentMessage[]> {
	let response = "";
	await expect
		.poll(async () => {
			response = await mcp.callText("maket_workspace", {
				action: "list_messages",
			});
			return response;
		})
		.toContain(text);
	return JSON.parse(response) as AgentMessage[];
}

function textContent(result: CallToolResult): string {
	const content = result.content.find((item) => item.type === "text");
	if (content?.type !== "text") throw new Error("Expected MCP text");
	return content.text;
}

async function pressFor(
	page: Page,
	button: Locator,
	durationMs: number,
): Promise<void> {
	const box = await button.boundingBox();
	if (!box) throw new Error("Hold button has no visible bounds");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(durationMs);
	await page.mouse.up();
}
