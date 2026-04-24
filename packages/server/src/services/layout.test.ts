import { describe, expect, it, vi } from "vitest";
import type { Document } from "../types.js";
import { createDocuments } from "./documents.js";
import {
	createLayoutService,
	formatLayoutReport,
	serverLayoutCheck,
} from "./layout.js";
import { createSQLiteStore } from "./store.js";
import { createWsRegistry, type WsLike } from "./ws-registry.js";

function openClient(): WsLike & { sent: string[] } {
	const sent: string[] = [];
	return {
		readyState: 1,
		send(msg) {
			sent.push(msg);
		},
		sent,
	};
}

function fixture() {
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const wsRegistry = createWsRegistry();
	const browserLaunch = vi.fn(async () => {
		throw new Error("no browser in tests");
	});
	const service = createLayoutService(
		{ documents, wsRegistry },
		{ browserLaunch, getAssetBaseUrl: () => "http://test" },
	);
	return {
		store,
		documents,
		wsRegistry,
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
	});
});

describe("formatLayoutReport (pure)", () => {
	it("returns OK when no overflow flags are set and clearance is comfortable", () => {
		const result = formatLayoutReport(
			{
				overflow: false,
				containerHeight: 1123,
				contentHeight: 500,
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

	it("flags a 'tight' page when bottom margin is below the min ship clearance", () => {
		// A4 threshold = max(10mm, 5% * 297mm) = ~14.85mm = ~56px at 96dpi.
		// container = 1123px (canvas), content = 1118px → 5px clearance → tight.
		const result = formatLayoutReport(
			{
				overflow: false,
				containerHeight: 1123,
				contentHeight: 1118,
			},
			A4,
		);
		expect(result.status).toBe("tight");
		expect(result.text).toMatch(/Layout tight/);
		expect(result.text).toMatch(/bottom margin \d+mm/);
		expect(result.text).toMatch(/Tighten.*before shipping/);
		expect(result.text).toContain("⚠");
		expect(result.overflowIds).toEqual([]);
	});

	it("returns overflow status (not decorative ⓘ) when headless is unavailable", () => {
		const result = formatLayoutReport(null, A4);
		expect(result.status).toBe("overflow");
		expect(result.text).toMatch(/unavailable/);
		expect(result.text).not.toContain("ⓘ");
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

	it("returns OK on a conforming layout", async () => {
		const { service, cleanup } = fixture();
		const html = `<div data-id="ok" style="width:100mm;height:100mm"></div>`;
		const result = await service.measure(doc(html), html, 0);
		expect(result.status).toBe("ok");
		expect(result.text).toMatch(/Layout OK/);
		cleanup();
	});

	it("uses the headless browser for content-driven overflow and rewrites asset URLs", async () => {
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const wsRegistry = createWsRegistry();
		const page = {
			setOfflineMode: vi.fn(async () => {}),
			setRequestInterception: vi.fn(async () => {}),
			on: vi.fn(),
			setViewport: vi.fn(async () => {}),
			setContent: vi.fn(async () => {}),
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
		const service = createLayoutService(
			{ documents, wsRegistry },
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
			{ waitUntil: "networkidle0" },
		);
		expect(page.close).toHaveBeenCalledOnce();
		store.close();
	});

	it("flags tight when headless reports content just under the min bottom clearance", async () => {
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const wsRegistry = createWsRegistry();
		const page = {
			setOfflineMode: vi.fn(async () => {}),
			setRequestInterception: vi.fn(async () => {}),
			on: vi.fn(),
			setViewport: vi.fn(async () => {}),
			setContent: vi.fn(async () => {}),
			evaluate: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({
				overflow: false,
				containerHeight: 1123,
				contentHeight: 1118,
			}),
			close: vi.fn(async () => {}),
		};
		const browser = {
			connected: true,
			on: vi.fn(),
			newPage: vi.fn(async () => page),
		};
		const browserLaunch = vi.fn(async () => browser as any);
		const service = createLayoutService(
			{ documents, wsRegistry },
			{ browserLaunch, getAssetBaseUrl: () => "http://test" },
		);
		// mm-math returns OK on a bare root, so the headless branch runs.
		const html = `<div data-id="root" style="width:210mm;height:297mm"></div>`;

		const result = await service.measure(doc(html), html, 0);

		expect(result.status).toBe("tight");
		expect(result.text).toMatch(/Layout tight/);
		expect(result.text).toMatch(/before shipping/);
		store.close();
	});

	it("broadcasts a state payload so connected previews refresh", async () => {
		const { service, wsRegistry, cleanup } = fixture();
		const client = openClient();
		wsRegistry.add(client);
		const html = `<div data-id="ok" style="width:100mm;height:100mm"></div>`;
		await service.measure(doc(html), html, 0);
		const payload = JSON.parse(client.sent[0] ?? "{}");
		expect(payload.type).toBe("state");
		expect(payload.doc?.name).toBe("d");
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

	it("does not broadcast on check (no preview mutation)", async () => {
		const { service, wsRegistry, cleanup } = fixture();
		const client = openClient();
		wsRegistry.add(client);
		const html = `<div data-id="ok" style="width:100mm;height:100mm"></div>`;
		await service.check(doc(html), html, 0);
		expect(client.sent.length).toBe(0);
		cleanup();
	});
});
