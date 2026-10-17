import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.use({ isMobile: true, hasTouch: true });
for (const width of [344, 690])
	test(`Images library and native photo choices at ${width}`, async ({
		page,
		mcp,
	}) => {
		const doc = "TEST no image insertion";
		await createDocument(mcp, doc);
		const before = JSON.stringify(
			await mcp.call("maket_html", { action: "get", doc, page: 1 }),
		);
		await page.setViewportSize({ width, height: 800 });
		await openWorkspace(page);
		const library = await openLibraryView(page, "photos");
		const box = await library.boundingBox();
		expect(box?.width).toBe(width);
		await expect(page.locator("[data-workspace-header]")).toHaveCount(0);
		await library
			.getByRole("button", { name: "Add image", exact: true })
			.click();
		await expect(
			library.getByRole("button", { name: "Existing photos", exact: true }),
		).toBeVisible();
		await expect(
			library.getByRole("button", { name: "Take a photo", exact: true }),
		).toBeVisible();
		await expect(library.locator("[data-mobile-camera-photo]")).toHaveAttribute(
			"capture",
			"environment",
		);
		const cancelled = page.waitForEvent("filechooser");
		await library
			.getByRole("button", { name: "Existing photos", exact: true })
			.click();
		await (await cancelled).setFiles([]);
		const initial = await page.request.get("/api/assets");
		expect((await initial.json()).images).toHaveLength(0);
		await library
			.getByRole("button", { name: "Add image", exact: true })
			.click();
		const chooser = page.waitForEvent("filechooser");
		await library
			.getByRole("button", {
				name: width === 344 ? "Existing photos" : "Take a photo",
				exact: true,
			})
			.click();
		const path = join(tmpdir(), `TEST-mobile-photo-${width}.png`);
		await writeFile(
			path,
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
				"base64",
			),
		);
		await (await chooser).setFiles(path);
		await expect(
			library.getByRole("img", { name: "Preview before adding", exact: true }),
		).toBeVisible();
		expect(
			(await (await page.request.get("/api/assets")).json()).images,
		).toHaveLength(0);
		await page.route("**/api/upload", (route) =>
			route.fulfill({ status: 500, json: { error: "TEST upload error" } }),
		);
		await library
			.getByRole("button", { name: "Add to library", exact: true })
			.click();
		await expect(library.getByRole("alert")).toContainText("TEST upload error");
		await page.unroute("**/api/upload");
		await library
			.getByRole("button", { name: "Add to library", exact: true })
			.click();
		await expect(library.getByRole("status")).toContainText(
			"Image added to the library",
		);
		const images = (await (await page.request.get("/api/assets")).json())
			.images;
		expect(images).toHaveLength(1);
		expect(images[0].file).toContain(`TEST-mobile-photo-${width}`);
		await expect(library.locator("[data-mobile-photo-detail]")).toBeVisible();
		await library
			.getByRole("button", { name: "Up one level", exact: true })
			.click();
		await expect(library.locator("[data-mobile-photo-entry]")).toBeVisible();
		expect(
			JSON.stringify(
				await mcp.call("maket_html", { action: "get", doc, page: 1 }),
			),
		).toBe(before);
		await page.screenshot({
			path: test.info().outputPath(`maket-photos-v7-${width}.png`),
		});
	});
