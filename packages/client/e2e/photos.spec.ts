import { expect, test } from "@playwright/test";
import { McpTestClient } from "./mcp-test-client";

const PNG_1PX = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

test("a rejected image request stays actionable and reports the failure", async ({
	page,
}) => {
	const docName = `photo-request-e2e-${Date.now()}`;
	const filename = `${docName}.png`;
	const mcp = await McpTestClient.connect();

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

		await page.getByRole("button", { name: /^photos$/i }).click();
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
			name: /insert into document|insérer dans le document/i,
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
		await mcp.close();
	}
});
