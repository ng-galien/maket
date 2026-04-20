import { expect, test } from "@playwright/test";

// Basic smoke: the built client, Express server, WebSocket and Zustand store
// all come up together. These tests don't seed documents — they just verify
// the stack wires up.

test.describe("App boot", () => {
	test("serves the root page with the app title", async ({ page }) => {
		const response = await page.goto("/");
		expect(response?.status()).toBe(200);
		await expect(page).toHaveTitle(/Maket/i);
	});

	test("renders the BottomBar dark-mode toggle (UI hydrated)", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(
			page.getByRole("button", { name: /dark mode|light mode/i }),
		).toBeVisible();
	});

	test("WebSocket connects within a few seconds (connection dot stops pulsing)", async ({
		page,
	}) => {
		await page.goto("/");
		// The connection dot pulses in red (animate-pulse) while disconnected;
		// once connected the class flips to bg-accent (no pulse).
		const dot = page.locator(".animate-pulse.bg-danger").first();
		// Either it was never visible (already connected at first paint) or it
		// disappears. We wait for "detached".
		await expect(dot).toHaveCount(0, { timeout: 5000 });
	});

	test("shows the no-document placeholder inside the BottomBar", async ({
		page,
	}) => {
		await page.goto("/");
		// The BottomBar placeholder sits inside a `max-w-[200px].truncate` span
		// so it's stable whether or not the DocsTab is also rendered.
		const placeholder = page.locator(".truncate", {
			hasText: /Aucun document|No document/i,
		});
		await expect(placeholder).toBeVisible();
	});
});
