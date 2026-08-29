import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import { decodeBundle } from "../lib/maket-format.js";
import type { Document } from "../types.js";
import { createBrowserPool } from "./browser-pool.js";
import { createBundleImportService } from "./bundle-import.js";
import { createBus } from "./bus.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createLayoutService } from "./layout.js";
import { createSQLiteStore } from "./store.js";

function documentWith(
	html: string,
	margins?: { top: number; right: number; bottom: number; left: number },
): Document {
	return {
		id: "browser-layout-test",
		name: "browser-layout-test",
		category: "general",
		canvas: {
			format: "custom",
			orientation: "portrait",
			w: 100,
			h: 100,
			bg: "#fff",
			...(margins ? { margins } : {}),
		},
		meta: {},
		elements: [],
		pages: [{ name: "P1", elements: [], html }],
		activePage: 0,
		nextId: 1,
	} as unknown as Document;
}

describe("LayoutService — Chromium measurement", () => {
	let browser: Browser | undefined;

	beforeAll(async () => {
		browser = await puppeteer.launch({
			headless: CHROMIUM_HEADLESS,
			args: shouldDisableSandbox() ? ["--no-sandbox"] : [],
		});
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	async function check(
		html: string,
		margins?: { top: number; right: number; bottom: number; left: number },
	) {
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const browserPool = createBrowserPool(
			{},
			{
				launch: async () => {
					if (!browser) throw new Error("Chromium did not start");
					return browser;
				},
			},
		);
		const layout = createLayoutService(
			{ bus: createBus(), documents, browserPool },
			{ getAssetBaseUrl: () => "http://localhost" },
		);
		try {
			return await layout.check(documentWith(html, margins), html, 0);
		} finally {
			store.close();
		}
	}

	async function checkBundle(filename: string) {
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const bus = createBus();
		const documentStates = createDocumentStates({ bus, documents, store });
		const bundle = await decodeBundle(
			await readFile(resolve(import.meta.dirname, "fixtures", filename)),
		);
		const imported = createBundleImportService({
			documents,
			documentStates,
			store,
			bus,
			config: {
				DATA_DIR: "/private/tmp/maket-layout-fixture",
				ASSETS_DIR: "/private/tmp/maket-layout-fixture/assets",
				EXPORTS_DIR: "/private/tmp/maket-layout-fixture/exports",
				DOCS_DIR: "/private/tmp/maket-layout-fixture/documents",
			} as never,
		}).restore(bundle);
		const document = documents.resolveOrLoad(imported.documents[0] ?? "");
		if (!document)
			throw new Error(`Fixture ${filename} did not import a document`);
		const browserPool = createBrowserPool(
			{},
			{
				launch: async () => {
					if (!browser) throw new Error("Chromium did not start");
					return browser;
				},
			},
		);
		const layout = createLayoutService(
			{ bus, documents, browserPool },
			{ getAssetBaseUrl: () => "http://localhost" },
		);
		try {
			return await Promise.all(
				document.pages.map((page, pageIndex) =>
					layout.check(document, page.html ?? "", pageIndex),
				),
			);
		} finally {
			store.close();
		}
	}

	it("detects visible overflow from a long pre line", async () => {
		const line = "0123456789".repeat(80);
		const result = await check(
			`<div data-id="page" style="width:100mm;height:100mm;overflow:hidden"><pre data-id="code" style="white-space:pre;overflow:visible">${line}</pre></div>`,
		);

		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Horizontal/);
		expect(result.overflowIds).toContain("code");
	});

	it("keeps the physical canvas tied to the Chromium viewport when authored CSS targets body", async () => {
		const result = await check(
			`<style>body{width:200mm!important;height:200mm!important}</style><div data-id="page" style="width:200mm;height:200mm"></div>`,
		);

		expect(result.status, result.text).toBe("overflow");
		expect(result.overflowIds).toContain("page");
		expect(result.measurements?.containerWidth).toBe(378);
		expect(result.measurements?.containerHeight).toBe(378);
	});

	it("excludes the full-page root from declared safe-margin checks", async () => {
		const result = await check(
			`<div data-id="page" style="position:relative;width:100mm;height:100mm"><div data-id="content" style="position:absolute;left:10mm;top:10mm;width:80mm;height:80mm"></div></div>`,
			{ top: 10, right: 10, bottom: 10, left: 10 },
		);

		expect(result.status, result.text).toBe("ok");
		expect(result.tightIds).toBeUndefined();
	});

	it("detects text clipped directly by the addressable page root", async () => {
		const line = "0123456789".repeat(80);
		const result = await check(
			`<div data-id="page" style="width:100mm;height:100mm;overflow:hidden;white-space:nowrap">${line}</div>`,
		);

		expect(result.status, result.text).toBe("overflow");
		expect(result.text).toMatch(/Clipped content: page/);
		expect(result.overflowIds).toContain("page");
	});

	it("uses a non-canonical addressable root when page HTML starts with styles", async () => {
		const line = "0123456789".repeat(80);
		const result = await check(
			`<style>.legacy-page{width:100mm;height:100mm;overflow:hidden}</style><div data-id="p4" class="legacy-page"><pre data-id="code" style="white-space:pre;overflow:visible">${line}</pre></div>`,
		);

		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Horizontal/);
		expect(result.overflowIds).toContain("code");
	});

	it("ignores a non-rendered addressable candidate before the page root", async () => {
		const line = "0123456789".repeat(80);
		const result = await check(
			`<style data-id="theme">.legacy-page{width:100mm;height:100mm;overflow:hidden}</style><div data-id="p4" class="legacy-page"><pre data-id="code" style="white-space:pre;overflow:visible">${line}</pre></div>`,
		);

		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Horizontal/);
		expect(result.overflowIds).toContain("code");
	});

	it("fails closed when multiple rendered legacy roots are ambiguous", async () => {
		const result = await check(
			`<div data-id="first" style="width:20mm;height:20mm"></div><div data-id="second" style="width:20mm;height:20mm"></div>`,
		);

		expect(result.status).toBe("unchecked");
		expect(result.text).toMatch(/No page root found/);
	});

	it("detects the real diagram page escaping the physical A4 canvas after a .maket round-trip", async () => {
		const [result] = await checkBundle("layout-diagram-overflow.maket");

		expect(result?.status, result?.text).toBe("overflow");
		expect(result?.overflowIds).toContain("p1");
		expect(result?.text).toMatch(/Physical canvas: 210×297mm/);
		expect(result?.text).toMatch(/Root `\[p1\]`/);
		expect(result?.text).toMatch(/canvas: bottom \+20px/);
	});

	it("reports that the real cards fit the canonical A4 canvas after a .maket round-trip", async () => {
		const [result] = await checkBundle("layout-cards-overflow.maket");

		expect(result?.status, result?.text).toBe("ok");
		expect(result?.overflowIds).toEqual([]);
		expect(result?.text).toMatch(/Root `\[p4\]`/);
		expect(result?.text).toMatch(/Content extent: 794×1123px/);
		expect(result?.measurements?.root?.height).toBe(1123);
	});

	it("detects text clipped by a constrained pre", async () => {
		const line = "0123456789".repeat(80);
		const result = await check(
			`<div data-id="page" style="width:100mm;height:100mm;overflow:hidden"><pre data-id="code" style="width:50mm;height:10mm;white-space:pre;overflow:hidden">${line}</pre></div>`,
		);

		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Clipped content: code/);
		expect(result.overflowIds).toContain("code");
	});

	it("allows intentional clipping of an oversized decoration", async () => {
		const result = await check(
			`<div data-id="page" style="width:100mm;height:100mm;overflow:hidden"><div data-id="hero" style="width:50mm;height:30mm;overflow:hidden"><div style="width:80mm;height:30mm;background:red"></div></div></div>`,
		);

		expect(result.status).toBe("ok");
	});

	it("ignores accessibility-only text and transparent checkbox inputs", async () => {
		const result = await check(
			`<style>.sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.control{position:relative;width:9mm;height:9mm}.input{position:absolute;width:1px;height:1px;opacity:0}.visual{width:8mm;height:8mm}</style><div data-id="page" style="width:100mm;height:100mm;overflow:hidden"><label data-id="control" class="control"><input data-id="input" class="input"><span data-id="visual" class="visual"></span><span data-id="label" class="sr-only">Toggle this item</span></label></div>`,
		);

		expect(result.status).toBe("ok");
	});

	it("excludes an explicitly marked decorative block from browser checks", async () => {
		const result = await check(
			`<div data-id="page" style="position:relative;width:100mm;height:100mm;overflow:hidden"><div data-id="hero" style="width:100mm;height:100mm"></div><div data-id="scrim" data-maket-layout="ignore" style="position:absolute;inset:0;width:120mm;height:120mm"></div></div>`,
		);

		expect(result.status).toBe("ok");
	});

	it("does not let an ignored container mask clipped descendant text", async () => {
		const line = "0123456789".repeat(80);
		const result = await check(
			`<div data-id="page" style="width:100mm;height:100mm;overflow:hidden"><div data-id="wrapper" data-maket-layout="ignore" style="width:50mm;height:20mm;overflow:hidden"><pre data-id="child" style="width:80mm;height:10mm;white-space:pre;overflow:visible">${line}</pre></div></div>`,
		);

		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Clipped content: wrapper/);
		expect(result.overflowIds).toContain("wrapper");
	});

	it("does not honor layout-ignore on an interactive control", async () => {
		const result = await check(
			`<div data-id="page" style="position:relative;width:100mm;height:100mm;overflow:hidden"><input data-id="control" data-maket-layout="ignore" style="position:absolute;left:450px;top:0;width:20px;height:20px"></div>`,
		);

		expect(result.status).toBe("overflow");
		expect(result.overflowIds).toContain("control");
	});
});
