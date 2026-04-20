import { expect, test } from "@playwright/test";

// The exchange flow: open the Messages panel, type a note, press Enter,
// verify it lands as a pending entry and the badge count updates.
// Needs a focused doc for the textarea to be enabled, so we inject one
// directly into the Zustand store (the full MCP round-trip is covered by
// server-side tests).

test.describe("Messages panel", () => {
	test("adding a note creates a pending entry and a badge", async ({
		page,
	}) => {
		await page.goto("/");

		// Inject a fake focused doc so the textarea isn't disabled.
		await page.evaluate(() => {
			const store = (window as unknown as { __maketStore?: unknown })
				.__maketStore;
			// The store isn't publicly exposed; fall back to localStorage + a
			// reload so the workspace reducer runs on boot. A single doc name
			// is enough — the backend won't have it but the UI gates on
			// `focusedDocName !== null`.
			localStorage.setItem("maket-workspace", JSON.stringify(["stub-doc"]));
			localStorage.setItem("maket-focused-doc", "stub-doc");
			void store;
		});
		await page.reload();

		// Open the exchange panel (icon-only button — match by `title`).
		const exchangeBtn = page.getByTitle(/exchanges|échanges/i);
		await exchangeBtn.click();

		const textarea = page.getByPlaceholder(
			/Note sur le document|Note about the document/i,
		);
		await expect(textarea).toBeVisible();
		await textarea.click();
		await page.keyboard.type("hello from e2e");
		await page.keyboard.press("Enter");

		// Badge — a "1" appears on the exchange button.
		await expect(exchangeBtn.locator("span")).toHaveText("1");

		// The pending entry shows the text in the list.
		await expect(page.getByText("hello from e2e")).toBeVisible();
	});
});
