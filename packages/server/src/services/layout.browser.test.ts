import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import type { Document } from "../types.js";
import { createBrowserPool } from "./browser-pool.js";
import { createBus } from "./bus.js";
import { createDocuments } from "./documents.js";
import { createLayoutService } from "./layout.js";
import { createSQLiteStore } from "./store.js";

function documentWith(html: string): Document {
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
	});

	async function check(html: string) {
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
			return await layout.check(documentWith(html), html, 0);
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
