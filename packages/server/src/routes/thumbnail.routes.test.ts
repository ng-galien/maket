import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../../tests/helpers.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import type { ThumbnailService } from "../services/thumbnail.js";
import { createDocument } from "../types.js";
import { createThumbnailRouter } from "./thumbnail.routes.js";

describe("thumbnail routes", () => {
	let store: Store;
	let documents: ReturnType<typeof createDocuments>;
	let thumbnailService: ThumbnailService;
	let baseUrl: string;
	let close: () => Promise<void>;

	beforeEach(async () => {
		store = createSQLiteStore(":memory:");
		documents = createDocuments({ store });
		thumbnailService = {
			render: vi.fn().mockResolvedValue(Buffer.from("png")),
		} as unknown as ThumbnailService;
		const app = express();
		app.use(createThumbnailRouter({ documents, store, thumbnailService }));
		({ baseUrl, close } = await startTestApp(app));
	});

	afterEach(async () => {
		await close();
		store.close();
	});

	function saveDoc(name = "thumb") {
		const doc = createDocument({
			name,
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [{ name: "P1", elements: [], html: '<div data-id="a">A</div>' }],
		});
		store.saveDoc(doc);
		documents.loadAll();
		return doc;
	}

	it("400s when the name parameter is missing", async () => {
		const res = await fetch(`${baseUrl}/api/thumb`);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "Missing ?name= parameter" });
	});

	it("404s when the document does not exist", async () => {
		const res = await fetch(`${baseUrl}/api/thumb?name=ghost`);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'Document "ghost" not found' });
	});

	it("renders a thumbnail with clamped page/width and immutable caching when t is provided", async () => {
		saveDoc();

		const res = await fetch(
			`${baseUrl}/api/thumb?name=thumb&page=0&w=5000&t=v1`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("cache-control")).toContain("immutable");
		expect(Buffer.from(await res.arrayBuffer()).toString("utf-8")).toBe("png");
		expect(thumbnailService.render).toHaveBeenCalledWith(
			expect.objectContaining({ name: "thumb" }),
			{ page: 0, widthPx: 2000, updatedAt: "v1" },
		);
	});

	it("uses store timestamps and no-cache when t is omitted", async () => {
		saveDoc("cached");

		const res = await fetch(`${baseUrl}/api/thumb?name=cached&page=2&w=10`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-cache");
		expect(thumbnailService.render).toHaveBeenCalledWith(
			expect.objectContaining({ name: "cached" }),
			expect.objectContaining({
				page: 1,
				widthPx: 60,
				updatedAt: expect.any(String),
			}),
		);
	});

	it("500s when thumbnail rendering fails", async () => {
		saveDoc("boom");
		vi.mocked(thumbnailService.render).mockRejectedValueOnce(new Error("boom"));

		const res = await fetch(`${baseUrl}/api/thumb?name=boom`);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: "boom" });
	});
});
