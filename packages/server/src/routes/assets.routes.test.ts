import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../../tests/helpers.js";
import { type AssetsService, createAssetsService } from "../services/assets.js";
import { createBus } from "../services/bus.js";
import type { Config } from "../services/config.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { createAssetsRouter } from "./assets.routes.js";

describe("assets routes", () => {
	let assetsDir: string;
	let store: Store;
	let assets: AssetsService;
	let baseUrl: string;
	let close: () => Promise<void>;
	let bus: ReturnType<typeof createBus>;

	beforeEach(async () => {
		assetsDir = mkdtempSync(join(tmpdir(), "maket-assets-route-"));
		store = createSQLiteStore(":memory:");
		bus = createBus();
		assets = createAssetsService({ assetsDir });
		vi.spyOn(assets, "optimize").mockResolvedValue(null);
		const config = { ASSETS_DIR: assetsDir } as Config;
		const app = express();
		app.use(createAssetsRouter({ config, store, bus, assets }));
		({ baseUrl, close } = await startTestApp(app));
	});

	afterEach(async () => {
		await close();
		store.close();
		rmSync(assetsDir, { recursive: true, force: true });
	});

	it("GET /api/assets merges on-disk files with DB metadata", async () => {
		writeFileSync(join(assetsDir, "hero.png"), "png");
		store.saveAsset({ filename: "hero.png", title: "Hero", category: "cover" });

		const res = await fetch(`${baseUrl}/api/assets`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			images: [
				expect.objectContaining({
					file: "hero.png",
					filename: "hero.png",
					title: "Hero",
					category: "cover",
				}),
			],
		});
	});

	it("serves a cached preview variant when present", async () => {
		mkdirSync(join(assetsDir, "preview"), { recursive: true });
		writeFileSync(join(assetsDir, "hero.png"), "original");
		writeFileSync(join(assetsDir, "preview", "hero.jpg"), "cached-preview");

		const res = await fetch(`${baseUrl}/assets/preview/hero.png`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("image/jpeg");
		expect(Buffer.from(await res.arrayBuffer()).toString("utf-8")).toBe(
			"cached-preview",
		);
	});

	it("rejects invalid JSON uploads", async () => {
		const res = await fetch(`${baseUrl}/api/upload`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{bad json",
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "Invalid JSON" });
	});

	it("rejects disallowed filenames", async () => {
		const badExt = await fetch(`${baseUrl}/api/upload`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				filename: "note.txt",
				data: Buffer.from("x").toString("base64"),
			}),
		});
		expect(badExt.status).toBe(400);
		expect(await badExt.json()).toEqual({
			error: 'Extension ".txt" not allowed',
		});
	});

	it("accepts JSON uploads, updates metadata.json, and emits assets:changed", async () => {
		writeFileSync(
			join(assetsDir, "metadata.json"),
			JSON.stringify({ images: [] }),
		);
		const changed = vi.fn();
		bus.on("assets:changed", changed);

		const res = await fetch(`${baseUrl}/api/upload`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				filename: "hello world.png",
				data: Buffer.from("pixel").toString("base64"),
			}),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			ok: true,
			file: "hello_world.png",
			replaced: false,
		});
		expect(readFileSync(join(assetsDir, "hello_world.png"), "utf-8")).toBe(
			"pixel",
		);
		expect(
			JSON.parse(readFileSync(join(assetsDir, "metadata.json"), "utf-8")),
		).toEqual({
			images: [
				{
					file: "hello_world.png",
					title: "hello world",
				},
			],
		});
		expect(changed).toHaveBeenCalledWith({});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(assets.optimize).toHaveBeenCalledWith("hello_world.png");
	});

	it("accepts multipart uploads", async () => {
		const boundary = "----maket-boundary";
		const body = Buffer.from(
			[
				`--${boundary}`,
				'Content-Disposition: form-data; name="file"; filename="poster.png"',
				"Content-Type: image/png",
				"",
				"poster-binary",
				`--${boundary}--`,
				"",
			].join("\r\n"),
			"utf-8",
		);

		const res = await fetch(`${baseUrl}/api/upload`, {
			method: "POST",
			headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
			body,
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			ok: true,
			file: "poster.png",
			replaced: false,
		});
		expect(readFileSync(join(assetsDir, "poster.png"), "utf-8")).toBe(
			"poster-binary",
		);
	});
});
