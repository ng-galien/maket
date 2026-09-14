import { describe, expect, it, vi } from "vitest";
import type { Document } from "../types.js";
import { createBus } from "./bus.js";
import { createDocuments } from "./documents.js";
import {
	createLayoutService,
	formatLayoutReport,
	serverLayoutCheck,
} from "./layout.js";
import { createSQLiteStore } from "./store.js";

function fixture() {
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const bus = createBus();
	const browserLaunch = vi.fn(async () => {
		throw new Error("no browser in tests");
	});
	const browserPool = {
		get: browserLaunch,
		dispose: vi.fn(async () => {}),
	};
	const service = createLayoutService(
		{ bus, documents, browserPool },
		{ browserLaunch, getAssetBaseUrl: () => "http://test" },
	);
	return {
		store,
		documents,
		bus,
		service,
		browserLaunch,
		cleanup: () => store.close(),
	};
}

function doc(html: string): Document {
	return {
		id: "id",
		name: "d",
		category: "general",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		meta: {},
		elements: [],
		pages: [{ name: "P1", elements: [], html }],
		activePage: 0,
		nextId: 1,
	} as unknown as Document;
}

const A4 = { w: 210, h: 297 };

describe("serverLayoutCheck (pure)", () => {
	it("reports no overflow on a conforming layout", () => {
		const html = `<div data-id="root" style="width:100mm;height:100mm"></div>`;
		const result = serverLayoutCheck(html, A4);
		expect(result.status).toBe("ok");
		expect(result.text).toMatch(/Layout OK/);
		expect(result.overflowIds).toEqual([]);
		expect(result.overlapIds).toEqual([]);
	});

	it("detects overflow on explicit width and surfaces the offending id", () => {
		const html = `<div data-id="big" style="width:400mm;height:50mm"></div>`;
		const result = serverLayoutCheck(html, A4);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(
			/Layout overflow — 1 issue\(s\)\. Not shippable/,
		);
		expect(result.text).toMatch(/width 400mm > canvas 210mm/);
		expect(result.text).toContain("⛔");
		expect(result.text).not.toContain("ⓘ");
		expect(result.text).not.toMatch(/non-blocking/);
		expect(result.overflowIds).toEqual(["big"]);
		expect(result.overlapIds).toEqual([]);
	});

	it("ignores only an explicitly marked block during static checks", () => {
		const html = [
			`<div data-id="decoration" data-maket-layout="ignore" style="width:400mm;height:400mm"></div>`,
			`<div data-id="content" style="width:300mm;height:50mm"></div>`,
		].join("");
		const result = serverLayoutCheck(html, A4);

		expect(result.status).toBe("overflow");
		expect(result.text).not.toContain("decoration");
		expect(result.overflowIds).toEqual(["content"]);
	});
});

describe("formatLayoutReport (pure)", () => {
	it("returns OK when no overflow / overlap / margin violation is reported", () => {
		const result = formatLayoutReport(
			{
				overflow: false,
				containerHeight: 1123,
				contentHeight: 1123,
				tight: { top: [], right: [], bottom: [], left: [] },
			},
			A4,
		);
		expect(result.status).toBe("ok");
		expect(result.text).toMatch(/Layout OK/);
	});

	it("formats vertical overflow with the stronger ⛔ marker", () => {
		const result = formatLayoutReport(
			{
				overflow: true,
				overflowBy: 42,
				contentHeight: 400,
				containerHeight: 358,
				overflowing: ["footer"],
			},
			A4,
		);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Layout overflow — not shippable/);
		expect(result.text).toMatch(
			/Vertical: content 400px > container 358px \(\+42px\)/,
		);
		expect(result.text).toContain("⛔");
		expect(result.text).not.toContain("ⓘ");
		expect(result.text).not.toMatch(/non-blocking/);
		expect(result.overflowIds).toContain("footer");
	});

	it("formats exact canvas and parent excess as a Markdown measurement report", () => {
		const result = formatLayoutReport(
			{
				overflow: true,
				containerHeight: 1123,
				containerWidth: 794,
				contentHeight: 1143,
				contentWidth: 794,
				overflowBy: 20,
				overflowing: ["diagram"],
				root: { id: "page", left: 0, top: 0, width: 794, height: 1143 },
				elements: [
					{
						id: "diagram",
						parentId: "page",
						left: 53,
						top: 48,
						width: 688,
						height: 1095,
						canvasExcess: { top: 0, right: 0, bottom: 20, left: 0 },
						parentExcess: { top: 0, right: 0, bottom: 0, left: 0 },
						overflow: true,
						canvasOverflow: true,
					},
				],
			},
			A4,
		);

		expect(result.text).toContain("### Measurements");
		expect(result.text).toContain("Physical canvas: 210×297mm (794×1123px)");
		expect(result.text).toContain(
			"Root `[page]`: x=0px, y=0px, w=794px, h=1143px",
		);
		expect(result.text).toContain("| `[diagram]` | physical canvas |");
		expect(result.text).toContain("canvas: bottom +20px");
		expect(result.measurements?.elements?.[0]?.parentId).toBe("page");
	});

	it("flags clipped internal content as non-shippable and surfaces the id", () => {
		const result = formatLayoutReport(
			{
				overflow: false,
				containerHeight: 1123,
				contentHeight: 600,
				clipped: ["body"],
			},
			A4,
		);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Clipped content: body/);
		expect(result.overflowIds).toEqual(["body"]);
	});

	it("reports visible content overflow without calling it clipped", () => {
		const result = formatLayoutReport(
			{
				overflow: true,
				containerHeight: 1123,
				contentHeight: 1123,
				containerWidth: 794,
				contentWidth: 960,
				overflowByW: 166,
				overflowing: ["code"],
				clipped: [],
			},
			A4,
		);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Horizontal: content 960px > container 794px/);
		expect(result.text).toMatch(/Overflowing: code/);
		expect(result.text).not.toMatch(/Clipped content/);
		expect(result.overflowIds).toEqual(["code"]);
	});

	it("flags 'tight' per-side when blocks cross declared margin bands", () => {
		const result = formatLayoutReport(
			{
				overflow: false,
				containerHeight: 1123,
				contentHeight: 1100,
				tight: {
					top: [],
					right: ["sidebar"],
					bottom: ["footer"],
					left: [],
				},
			},
			A4,
		);
		expect(result.status).toBe("tight");
		expect(result.text).toMatch(/Layout tight/);
		expect(result.text).toMatch(/right: sidebar/);
		expect(result.text).toMatch(/bottom: footer/);
		expect(result.text).toContain("⚠");
		expect(result.tightIds).toEqual(
			expect.arrayContaining(["sidebar", "footer"]),
		);
		expect(result.overflowIds).toEqual([]);
	});

	it("returns OK when margins are declared but no block crosses them", () => {
		const result = formatLayoutReport(
			{
				overflow: false,
				containerHeight: 1123,
				contentHeight: 600,
				tight: { top: [], right: [], bottom: [], left: [] },
			},
			A4,
		);
		expect(result.status).toBe("ok");
	});

	it("returns overflow status (not decorative ⓘ) when headless is unavailable", () => {
		const result = formatLayoutReport(null, A4);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/unavailable/);
		expect(result.text).not.toContain("ⓘ");
	});

	it("flags pairwise overlap as non-shippable and surfaces both ids", () => {
		const result = formatLayoutReport(
			{
				overflow: false,
				containerHeight: 1123,
				contentHeight: 600,
				overlaps: [["a", "b"]],
			},
			A4,
		);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Layout overlap — not shippable/);
		expect(result.text).not.toMatch(/Layout overflow —/);
		expect(result.text).toMatch(/Overlapping: a ↔ b/);
		expect(result.text).toContain("⛔");
		expect(result.overlapIds).toEqual(["a", "b"]);
		expect(result.overflowIds).toEqual([]);
	});

	it("co-reports overflow and overlap when both occur", () => {
		const result = formatLayoutReport(
			{
				overflow: true,
				overflowBy: 40,
				contentHeight: 1163,
				containerHeight: 1123,
				overflowing: ["foot"],
				overlaps: [["a", "b"]],
			},
			A4,
		);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Layout overflow and overlap — not shippable/);
		expect(result.text).toMatch(/Vertical: content 1163px/);
		expect(result.text).toMatch(/Overflowing: foot/);
		expect(result.text).toMatch(/Overlapping: a ↔ b/);
		expect(result.overflowIds).toContain("foot");
		expect(result.overlapIds).toEqual(["a", "b"]);
	});
});

describe("LayoutService — measure", () => {
	it("falls back to server check when puppeteer is unavailable", async () => {
		const { service, cleanup } = fixture();
		const html = `<div data-id="big" style="width:400mm;height:50mm"></div>`;
		const result = await service.measure(doc(html), html, 0);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Layout overflow/);
		expect(result.overflowIds).toContain("big");
		// measure() keeps the leading newline for direct concatenation.
		expect(result.text.startsWith("\n")).toBe(true);
		cleanup();
	});

	it("does not launch puppeteer when the server-side mm checks already found overflow", async () => {
		const { service, browserLaunch, cleanup } = fixture();
		const html = `<div data-id="big" style="width:400mm;height:50mm"></div>`;
		await service.measure(doc(html), html, 0);
		expect(browserLaunch).not.toHaveBeenCalled();
		cleanup();
	});

	it("runs headless for an explicit check so the public result can include measurements", async () => {
		const { service, browserLaunch, cleanup } = fixture();
		const html = `<div data-id="big" style="width:400mm;height:50mm"></div>`;
		const result = await service.check(doc(html), html, 0);
		expect(browserLaunch).toHaveBeenCalledOnce();
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Full layout check unavailable/);
		cleanup();
	});

	it("returns unchecked when static checks pass but headless is unavailable", async () => {
		const { service, cleanup } = fixture();
		const html = `<div data-id="ok" style="width:100mm;height:100mm"></div>`;
		const result = await service.measure(doc(html), html, 0);
		expect(result.status).toBe("unchecked");
		expect(result.text).toMatch(/Layout check unavailable/);
		expect(result.text).toMatch(/no browser in tests/);
		expect(result.text).toMatch(/not shippable/);
		cleanup();
	});

	it("uses the headless browser for content-driven overflow and rewrites asset URLs", async () => {
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const bus = createBus();
		const page = {
			setOfflineMode: vi.fn(async () => {}),
			setRequestInterception: vi.fn(async () => {}),
			on: vi.fn(),
			setViewport: vi.fn(async () => {}),
			setContent: vi.fn(async () => {}),
			waitForNetworkIdle: vi.fn(async () => {}),
			evaluate: vi
				.fn()
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					overflow: true,
					containerHeight: 100,
					contentHeight: 140,
					overflowBy: 40,
					overflowing: ["body"],
				}),
			close: vi.fn(async () => {}),
		};
		const browser = {
			connected: true,
			on: vi.fn(),
			newPage: vi.fn(async () => page),
		};
		const browserLaunch = vi.fn(async () => browser as any);
		const browserPool = {
			get: browserLaunch,
			dispose: vi.fn(async () => {}),
		};
		const service = createLayoutService(
			{ bus, documents, browserPool },
			{ browserLaunch, getAssetBaseUrl: () => "http://test" },
		);
		const html = `<div data-id="root"><img data-id="img" src="/assets/hero.png"></div>`;

		const result = await service.measure(doc(html), html, 0);

		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(
			/Vertical: content 140px > container 100px \(\+40px\)/,
		);
		expect(result.overflowIds).toContain("body");
		expect(browserLaunch).toHaveBeenCalledOnce();
		expect(page.setContent).toHaveBeenCalledWith(
			expect.stringContaining("http://test/assets/hero.png"),
			{ waitUntil: "load" },
		);
		expect(page.close).toHaveBeenCalledOnce();
		store.close();
	});

	it("flags tight per-side when headless reports a block crossing the bottom margin", async () => {
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const bus = createBus();
		const page = {
			setOfflineMode: vi.fn(async () => {}),
			setRequestInterception: vi.fn(async () => {}),
			on: vi.fn(),
			setViewport: vi.fn(async () => {}),
			setContent: vi.fn(async () => {}),
			waitForNetworkIdle: vi.fn(async () => {}),
			evaluate: vi
				.fn()
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					overflow: false,
					containerHeight: 1123,
					contentHeight: 1100,
					tight: { top: [], right: [], bottom: ["footer"], left: [] },
				}),
			close: vi.fn(async () => {}),
		};
		const browser = {
			connected: true,
			on: vi.fn(),
			newPage: vi.fn(async () => page),
		};
		const browserLaunch = vi.fn(async () => browser as any);
		const browserPool = {
			get: browserLaunch,
			dispose: vi.fn(async () => {}),
		};
		const service = createLayoutService(
			{ bus, documents, browserPool },
			{ browserLaunch, getAssetBaseUrl: () => "http://test" },
		);
		const html = `<div data-id="root" style="width:210mm;height:297mm"></div>`;

		const result = await service.measure(doc(html), html, 0);

		expect(result.status).toBe("tight");
		expect(result.text).toMatch(/Layout tight/);
		expect(result.text).toMatch(/bottom: footer/);
		store.close();
	});

	it("returns unchecked on time even when closing a timed-out page also hangs", async () => {
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const bus = createBus();
		const page = {
			setOfflineMode: vi.fn(async () => {}),
			setRequestInterception: vi.fn(async () => {}),
			on: vi.fn(),
			setViewport: vi.fn(async () => {}),
			setContent: vi.fn(() => new Promise<void>(() => {})),
			close: vi.fn(() => new Promise<void>(() => {})),
		};
		const browser = {
			connected: true,
			newPage: vi.fn(async () => page),
		};
		const browserPool = {
			get: vi.fn(async () => browser as any),
			dispose: vi.fn(async () => {}),
		};
		const service = createLayoutService(
			{ bus, documents, browserPool },
			{ getAssetBaseUrl: () => "http://test", headlessTimeoutMs: 5 },
		);
		const html = `<div data-id="root" style="width:100mm;height:100mm"></div>`;

		const startedAt = Date.now();
		const result = await service.check(doc(html), html, 0);

		expect(result.status).toBe("unchecked");
		expect(result.text).toMatch(/timed out after 5ms/);
		expect(page.close).toHaveBeenCalledOnce();
		expect(Date.now() - startedAt).toBeLessThan(100);
		store.close();
	});

	it("returns unchecked when headless fails and closing the page also hangs", async () => {
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const bus = createBus();
		const page = {
			setOfflineMode: vi.fn(async () => {}),
			setRequestInterception: vi.fn(async () => {}),
			on: vi.fn(),
			setViewport: vi.fn(async () => {}),
			setContent: vi.fn(async () => {
				throw new Error("render failed");
			}),
			close: vi.fn(() => new Promise<void>(() => {})),
		};
		const browser = {
			connected: true,
			newPage: vi.fn(async () => page),
		};
		const browserPool = {
			get: vi.fn(async () => browser as any),
			dispose: vi.fn(async () => {}),
		};
		const service = createLayoutService(
			{ bus, documents, browserPool },
			{ getAssetBaseUrl: () => "http://test", headlessTimeoutMs: 1_000 },
		);
		const html = `<div data-id="root" style="width:100mm;height:100mm"></div>`;

		const startedAt = Date.now();
		const result = await service.check(doc(html), html, 0);

		expect(result.status).toBe("unchecked");
		expect(result.text).toMatch(/render failed/);
		expect(page.close).toHaveBeenCalledOnce();
		expect(Date.now() - startedAt).toBeLessThan(100);
		store.close();
	});

	it("emits document:saved so connected previews can refresh", async () => {
		const { service, bus, cleanup } = fixture();
		const saved = vi.fn();
		bus.on("document:saved", saved);
		const html = `<div data-id="ok" style="width:100mm;height:100mm"></div>`;
		await service.measure(doc(html), html, 0);
		expect(saved).toHaveBeenCalledWith({ docName: "d" });
		cleanup();
	});
});

describe("LayoutService — check", () => {
	it("falls back to server check when puppeteer is unavailable", async () => {
		const { service, cleanup } = fixture();
		const html = `<div data-id="big" style="width:400mm;height:50mm"></div>`;
		const result = await service.check(doc(html), html, 0);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/Layout overflow/);
		cleanup();
	});

	it("does not emit document:saved on check (no preview mutation)", async () => {
		const { service, bus, cleanup } = fixture();
		const saved = vi.fn();
		bus.on("document:saved", saved);
		const html = `<div data-id="ok" style="width:100mm;height:100mm"></div>`;
		await service.check(doc(html), html, 0);
		expect(saved).not.toHaveBeenCalled();
		cleanup();
	});
});
