import { readFile } from "node:fs/promises";
import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.use({
	isMobile: true,
	hasTouch: true,
	viewport: { width: 344, height: 800 },
});
for (const mode of [
	"warm",
	"cold",
	"slow",
	"unsupported",
	"cancel",
	"error",
	"revision",
	"dismiss",
]) {
	test(`PDF one-action lifecycle: ${mode}`, async ({ page, mcp }) => {
		await page.addInitScript((mode) => {
			Object.defineProperty(navigator, "canShare", {
				configurable: true,
				value: () => mode !== "unsupported",
			});
			Object.defineProperty(navigator, "share", {
				configurable: true,
				value: async (data: ShareData) => {
					const active = navigator.userActivation.isActive;
					document.documentElement.dataset.testShareActivation = String(active);
					if (!active)
						throw new DOMException("Activation expired", "NotAllowedError");
					if (mode === "cancel")
						throw new DOMException("Cancelled", "AbortError");
					const file = data.files?.[0];
					if (file)
						document.documentElement.dataset.testPdfShare = JSON.stringify({
							name: file.name,
							type: file.type,
							size: file.size,
							prefix: (await file.text()).slice(0, 5),
							hash: Array.from(
								new Uint8Array(
									await crypto.subtle.digest(
										"SHA-256",
										await file.arrayBuffer(),
									),
								),
							)
								.map((x) => x.toString(16).padStart(2, "0"))
								.join(""),
						});
				},
			});
		}, mode);
		const doc = `TEST PDF ${mode}`;
		await createDocument(mcp, doc);
		let exports = 0;
		await page.route("**/api/export-pdf?**", async (route) => {
			exports++;
			if (mode === "error") {
				await route.fulfill({ status: 503, body: "Unavailable" });
				return;
			}
			const response = await route.fetch();
			if (["cold", "slow", "dismiss"].includes(mode))
				await new Promise((resolve) =>
					setTimeout(resolve, mode === "slow" ? 6500 : 1200),
				);
			await route.fulfill({ response });
		});
		await openWorkspace(page);
		const library = await openLibraryView(page, "docs");
		await library
			.getByRole("searchbox", { name: "Search this library", exact: true })
			.fill(doc);
		const prepared = page.waitForResponse("**/api/export-pdf?**");
		await library
			.locator("[data-mobile-explorer-entry]")
			.filter({ hasText: doc })
			.click();
		if (!["cold", "slow", "dismiss"].includes(mode)) {
			await prepared;
			await page.waitForTimeout(100);
		}
		const openMenu = () =>
			page
				.locator("[data-mobile-simple-header]")
				.getByRole("button", { name: `Document actions: ${doc}`, exact: true })
				.click();
		await openMenu();
		const button = page.getByRole("button", { name: "Share", exact: true });
		const downloaded =
			mode === "unsupported" ? page.waitForEvent("download") : null;
		await button.click();
		if (["cold", "slow", "dismiss"].includes(mode)) {
			const waiting = page.locator("[data-mobile-pdf-preparing]");
			await expect(waiting).toBeVisible();
			const box = await waiting.boundingBox();
			expect(box).toMatchObject({ x: 0, y: 0, width: 344, height: 800 });
			await expect(
				page.getByRole("button", { name: "Share", exact: true }),
			).toHaveCount(0);
			if (mode === "dismiss") {
				await waiting
					.getByRole("button", { name: "Cancel", exact: true })
					.click();
				await prepared;
				await page.waitForTimeout(100);
				await expect(page.locator("html")).not.toHaveAttribute(
					"data-test-pdf-share",
				);
				await expect(page.getByRole("dialog")).toHaveCount(0);
				return;
			}
		}
		if (mode === "slow") await page.waitForTimeout(8000);
		if (mode === "error" || mode === "slow") {
			await expect(page.getByRole("alert")).toContainText(
				mode === "error" ? "503" : "browser blocked native sharing",
				{ timeout: 12000 },
			);
			if (mode === "slow")
				await expect(page.locator("html")).toHaveAttribute(
					"data-test-share-activation",
					"false",
				);
			await expect(page.locator("html")).not.toHaveAttribute(
				"data-test-pdf-share",
			);
		} else if (downloaded) {
			const path = await (await downloaded).path();
			if (!path) throw Error("Missing exported PDF");
			expect((await readFile(path)).subarray(0, 5).toString()).toBe("%PDF-");
			await expect(
				page.getByRole("status").filter({ hasText: "exported instead" }),
			).toBeVisible();
		} else if (mode === "cancel") {
			await expect(page.locator("html")).toHaveAttribute(
				"data-test-share-activation",
				"true",
			);
			await expect(page.locator("html")).not.toHaveAttribute(
				"data-test-pdf-share",
			);
		} else {
			await expect(page.locator("html")).toHaveAttribute(
				"data-test-pdf-share",
				/application\/pdf/,
			);
			const first = JSON.parse(
				(await page.locator("html").getAttribute("data-test-pdf-share")) ??
					"null",
			);
			expect(first).toMatchObject({
				name: `${doc}.pdf`,
				type: "application/pdf",
				prefix: "%PDF-",
			});
			expect(first.size).toBeGreaterThan(100);
			await expect(page.locator("html")).toHaveAttribute(
				"data-test-share-activation",
				"true",
			);
			if (mode === "revision") {
				const refreshed = page.waitForResponse("**/api/export-pdf?**");
				await mcp.call("maket_html", {
					action: "set",
					doc,
					page: 1,
					html: '<main data-id="updated"><h1>Current revised document</h1></main>',
				});
				await refreshed;
				await page.waitForTimeout(100);
				await openMenu();
				await button.click();
				await expect
					.poll(
						async () =>
							JSON.parse(
								(await page
									.locator("html")
									.getAttribute("data-test-pdf-share")) ?? "null",
							).hash,
					)
					.not.toBe(first.hash);
				expect(exports).toBeGreaterThan(1);
			}
		}
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.locator("[data-mobile-pdf-preparing]")).toHaveCount(0);
	});
}
