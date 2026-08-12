import { expect, openWorkspace, test } from "./workspace-test";

// Basic smoke: the built client, Express server, WebSocket and Zustand store
// all come up together. These tests don't seed documents — they just verify
// the stack wires up.

test.describe("Workspace shell", () => {
	test("boots the public app and exposes its primary controls", async ({
		page,
	}) => {
		const response = await page.goto("/");
		expect(response?.status()).toBe(200);
		await expect(page).toHaveTitle(/Maket/i);
		await expect(
			page.getByRole("button", { name: /dark mode|light mode/i }),
		).toBeVisible();
		await expect(page.locator(".animate-pulse.bg-danger")).toHaveCount(0, {
			timeout: 5_000,
		});
		const placeholder = page.locator(".truncate", {
			hasText: /Aucun document|No document/i,
		});
		await expect(placeholder).toBeVisible();
	});

	test("offers document selection instead of a disabled note composer", async ({
		page,
	}) => {
		await openWorkspace(page);
		await page.getByRole("button", { name: /^(exchanges|échanges)$/i }).click();
		await expect(
			page.getByRole("button", {
				name: /choose a document|choisir un document/i,
			}),
		).toBeVisible();
		await expect(
			page.getByPlaceholder(/Note sur le document|Note about the document/i),
		).toHaveCount(0);
	});
});
