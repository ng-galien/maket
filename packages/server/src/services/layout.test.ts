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

	it("returns OK on a conforming layout but flags headless-unavailable", async () => {
		const { service, cleanup } = fixture();
		const html = `<div data-id="ok" style="width:100mm;height:100mm"></div>`;
		const result = await service.measure(doc(html), html, 0);
		// fixture's browserLaunch throws → headless unavailable → server-OK
		// is wrapped with an explicit caveat so the agent doesn't treat ✓ as
		// full validation (no overlap / content-overflow check ran).
		expect(result.status).toBe("ok");
		expect(result.text).toMatch(/Layout OK \(headless unavailable/);
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

	it("flags tight per-side when headless reports a block crossing the bottom margin", async () => {
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
		const service = createLayoutService(
			{ documents, wsRegistry },
			{ browserLaunch, getAssetBaseUrl: () => "http://test" },
		);
		const html = `<div data-id="root" style="width:210mm;height:297mm"></div>`;

		const result = await service.measure(doc(html), html, 0);

		expect(result.status).toBe("tight");
		expect(result.text).toMatch(/Layout tight/);
		expect(result.text).toMatch(/bottom: footer/);
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
