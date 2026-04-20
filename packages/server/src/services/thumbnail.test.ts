import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "../types.js";
import { createAssetsService } from "./assets.js";
import type { BrowserPool } from "./browser-pool.js";
import type { Config } from "./config.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";
import { createThumbnailService } from "./thumbnail.js";

function makeDoc(overrides: Partial<Document> = {}): Document {
	return {
		id: "id-1",
		name: "d1",
		category: "general",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		meta: {},
		pages: [{ name: "P1", elements: [], html: '<div data-id="a">x</div>' }],
		activePage: 0,
		nextId: 1,
		...overrides,
	} as Document;
}

function fixture() {
	const tmp = mkdtempSync(join(tmpdir(), "maket-thumb-"));
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const assets = createAssetsService({ assetsDir: tmp });
	const config = {
		ASSETS_DIR: tmp,
		DATA_DIR: tmp,
		DB_PATH: ":memory:",
	} as unknown as Config;
	const browserPool = {
		get: vi.fn(),
		dispose: vi.fn(async () => {}),
	} as unknown as BrowserPool;
	const snapshot = vi.fn(
		async (
			html: string,
			_viewport: { width: number; height: number; deviceScaleFactor: number },
			_pool: BrowserPool,
		) => Buffer.from(`PNG[${html.length}]`),
	);
	const service = createThumbnailService(
		{ documents, config, assets, browserPool },
		{ snapshot, maxCacheEntries: 3 },
	);
	return {
		store,
		documents,
		service,
		snapshot,
		browserPool,
		cleanup: () => {
			store.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

describe("createThumbnailService", () => {
	it("rejects a page that has no HTML", async () => {
		const { service, cleanup } = fixture();
		const doc = makeDoc({ pages: [{ name: "empty", elements: [] }] });
		await expect(service.render(doc)).rejects.toThrow(/no HTML/);
		cleanup();
	});

	it("renders with the injected snapshot fn and viewport matches the target width", async () => {
		const { service, snapshot, cleanup } = fixture();
		const doc = makeDoc();
		const buf = await service.render(doc, { widthPx: 400 });
		expect(Buffer.isBuffer(buf)).toBe(true);
		expect(snapshot).toHaveBeenCalledOnce();
		const viewport = snapshot.mock.calls[0]![1];
		expect(viewport.width).toBe(400);
		// A4 portrait: 297/210 ≈ 1.414 → 400 × 1.414 ≈ 566
		expect(viewport.height).toBeGreaterThan(560);
		expect(viewport.height).toBeLessThan(572);
		expect(viewport.deviceScaleFactor).toBe(2);
		cleanup();
	});

	it("caches by (docId, updatedAt, page, widthPx)", async () => {
		const { service, snapshot, cleanup } = fixture();
		const doc = makeDoc();
		await service.render(doc, { widthPx: 400, updatedAt: "t1" });
		await service.render(doc, { widthPx: 400, updatedAt: "t1" });
		expect(snapshot).toHaveBeenCalledTimes(1);
		// Different updatedAt → miss
		await service.render(doc, { widthPx: 400, updatedAt: "t2" });
		expect(snapshot).toHaveBeenCalledTimes(2);
		// Different widthPx → miss
		await service.render(doc, { widthPx: 240, updatedAt: "t2" });
		expect(snapshot).toHaveBeenCalledTimes(3);
		cleanup();
	});

	it("clamps widthPx into the [60, 2000] range", async () => {
		const { service, snapshot, cleanup } = fixture();
		const doc = makeDoc();
		await service.render(doc, { widthPx: 10 });
		expect(snapshot.mock.calls[0]![1].width).toBe(60);
		await service.render(doc, { widthPx: 9999 });
		expect(snapshot.mock.calls[1]![1].width).toBe(2000);
		cleanup();
	});

	it("invalidate() drops every cached PNG for a given doc id", async () => {
		const { service, snapshot, cleanup } = fixture();
		const doc = makeDoc();
		await service.render(doc, { widthPx: 400, updatedAt: "t1" });
		await service.render(doc, { widthPx: 240, updatedAt: "t1" });
		expect(service.cacheSize()).toBe(2);
		service.invalidate(doc.id);
		expect(service.cacheSize()).toBe(0);
		await service.render(doc, { widthPx: 400, updatedAt: "t1" });
		expect(snapshot).toHaveBeenCalledTimes(3);
		cleanup();
	});

	it("evicts oldest entry when maxCacheEntries is reached", async () => {
		const { service, cleanup } = fixture();
		const doc1 = makeDoc({ id: "a" });
		const doc2 = makeDoc({ id: "b" });
		const doc3 = makeDoc({ id: "c" });
		const doc4 = makeDoc({ id: "d" });
		await service.render(doc1);
		await service.render(doc2);
		await service.render(doc3);
		expect(service.cacheSize()).toBe(3);
		await service.render(doc4);
		expect(service.cacheSize()).toBe(3);
		cleanup();
	});

	it("injects the doc's charte CSS into the rendered HTML", async () => {
		const { service, snapshot, store, documents, cleanup } = fixture();
		store.saveCharte({
			name: "brand",
			tokens: { color: { primary: "#ff00ff" } },
		});
		documents.loadAll();
		const doc = makeDoc({ meta: { charte: "brand" } });
		await service.render(doc);
		const html = snapshot.mock.calls[0]![0];
		expect(html).toContain("--charte-color-primary");
		expect(html).toContain("#ff00ff");
		cleanup();
	});
});
