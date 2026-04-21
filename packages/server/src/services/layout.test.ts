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

describe("serverLayoutCheck (pure)", () => {
	it("reports no overflow on a conforming layout", () => {
		const html = `<div data-id="root" style="width:100mm;height:100mm"></div>`;
		expect(serverLayoutCheck(html, { w: 210, h: 297 })).toMatch(/Layout OK/);
	});

	it("detects overflow on explicit width", () => {
		const html = `<div data-id="big" style="width:400mm;height:50mm"></div>`;
		const out = serverLayoutCheck(html, { w: 210, h: 297 });
		expect(out).toMatch(/Layout overflow — non-blocking/);
		expect(out).toMatch(/width 400mm > canvas 210mm/);
	});
});

describe("formatLayoutReport (pure)", () => {
	it("returns OK when no overflow flags are set", () => {
		expect(formatLayoutReport({ overflow: false })).toMatch(/Layout OK/);
	});

	it("formats vertical overflow", () => {
		const out = formatLayoutReport({
			overflow: true,
			overflowBy: 42,
			contentHeight: 400,
			containerHeight: 358,
		});
		expect(out).toMatch(/Layout overflow — non-blocking/);
		expect(out).toMatch(/Vertical: content 400px > container 358px \(\+42px\)/);
	});

	it("returns 'unavailable' on null input", () => {
		expect(formatLayoutReport(null)).toMatch(/unavailable/);
	});
});

describe("LayoutService — measure", () => {
	it("falls back to server check when puppeteer is unavailable", async () => {
		const { service, cleanup } = fixture();
		const html = `<div data-id="big" style="width:400mm;height:50mm"></div>`;
		const report = await service.measure(doc(html), html, 0);
		expect(report).toMatch(/Layout overflow — non-blocking/);
		// measure() keeps the leading newline for direct concatenation.
		expect(report.startsWith("\n")).toBe(true);
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
		const report = await service.measure(doc(html), html, 0);
		expect(report).toMatch(/Layout OK/);
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
			evaluate: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({
				overflow: true,
				containerHeight: 100,
				contentHeight: 140,
				overflowBy: 40,
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

		const report = await service.measure(doc(html), html, 0);

		expect(report).toMatch(
			/Vertical: content 140px > container 100px \(\+40px\)/,
		);
		expect(browserLaunch).toHaveBeenCalledOnce();
		expect(page.setContent).toHaveBeenCalledWith(
			expect.stringContaining("http://test/assets/hero.png"),
			{ waitUntil: "networkidle0" },
		);
		expect(page.close).toHaveBeenCalledOnce();
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
		const report = await service.check(doc(html), html, 0);
		expect(report).toMatch(/Layout overflow — non-blocking/);
		// check() trims leading newline
		expect(report.startsWith("\n")).toBe(false);
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
