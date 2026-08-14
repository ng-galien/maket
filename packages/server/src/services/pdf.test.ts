import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "../types.js";
import { createAssetsService } from "./assets.js";
import type { Config } from "./config.js";
import { createDocumentRenderer } from "./document-renderer.js";
import { createDocuments } from "./documents.js";
import {
	boxShadowToDropShadow,
	buildPrintHtml,
	buildShadowVarMap,
	createPdfService,
} from "./pdf.js";
import { createStateRenderer } from "./state-renderer.js";
import { createSQLiteStore } from "./store.js";

function fixture() {
	const tmp = mkdtempSync(join(tmpdir(), "maket-pdf-"));
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const assets = createAssetsService({ assetsDir: tmp });
	const config = {
		ASSETS_DIR: tmp,
	} as unknown as Config;
	const browserLaunch = vi.fn(async () => {
		throw new Error("no browser in tests");
	});
	// Unused here — `browserLaunch` short-circuits inside createPdfService —
	// but the signature requires it.
	const browserPool = {
		get: async () => {
			throw new Error("pool not exercised in tests");
		},
		dispose: async () => {},
	};
	const service = createPdfService(
		{ documents, config, assets, browserPool },
		{ browserLaunch },
	);
	return {
		store,
		service,
		browserLaunch,
		cleanup: () => {
			store.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

function makeDoc(overrides: Partial<Document> = {}): Document {
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
		pages: [],
		activePage: 0,
		nextId: 1,
		...overrides,
	} as unknown as Document;
}

describe("buildShadowVarMap", () => {
	it("extracts only --charte-shadow-* vars", () => {
		const css = `
      :root {
        --charte-color-primary: #ff0000;
        --charte-shadow-soft: 0 2px 4px rgba(0,0,0,0.1);
        --charte-shadow-hard: 0 8px 16px black;
      }
    `;
		const map = buildShadowVarMap(css);
		expect(map.size).toBe(2);
		expect(map.get("--charte-shadow-soft")).toMatch(/0 2px 4px/);
	});
});

describe("boxShadowToDropShadow", () => {
	it("rewrites inline box-shadow to filter:drop-shadow()", () => {
		const html = `<div style="box-shadow: 0 4px 8px #000"></div>`;
		const out = boxShadowToDropShadow(html, new Map());
		expect(out).toMatch(/filter:drop-shadow\(0 4px 8px #000\)/);
	});

	it("resolves var() references from the shadow map", () => {
		const html = `<div style="box-shadow: var(--charte-shadow-soft)"></div>`;
		const out = boxShadowToDropShadow(
			html,
			new Map([["--charte-shadow-soft", "0 2px 4px rgba(0,0,0,0.1)"]]),
		);
		expect(out).toMatch(/filter:drop-shadow\(0 2px 4px rgba\(0,0,0,0\.1\)\)/);
	});

	it("keeps 'none' as box-shadow:none (not a filter)", () => {
		const html = `<div style="box-shadow: none"></div>`;
		const out = boxShadowToDropShadow(html, new Map());
		expect(out).toMatch(/box-shadow:none/);
	});
});

describe("buildPrintHtml", () => {
	it("wraps each page in a private render frame and inserts @page size", () => {
		const doc = makeDoc();
		const out = buildPrintHtml(
			doc,
			[`<p data-id="a">A</p>`, `<p data-id="b">B</p>`],
			"",
		);
		expect(out).toMatch(/@page \{ size: 210mm 297mm/);
		expect(out).toMatch(/<maket-render-page/);
		// Second page starts with page-break-before
		expect(out).toMatch(/page-break-before:always/);
	});
});

describe("PdfService.render", () => {
	it("passes hydrated native control state into the PDF page", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "maket-pdf-state-"));
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const assets = createAssetsService({ assetsDir: tmp });
		const setContent = vi.fn(async (_html: string, _options?: unknown) => {});
		const page = {
			setRequestInterception: vi.fn(async () => {}),
			on: vi.fn(),
			setContent,
			waitForNetworkIdle: vi.fn(async () => {}),
			evaluate: vi.fn(async () => {}),
			pdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
			close: vi.fn(async () => {}),
		};
		const doc = makeDoc({
			dataModel: "state",
			pages: [
				{
					id: "page-p",
					name: "P",
					elements: [],
					html: '<input type="checkbox" data-maket-bind="state.done"><input type="text" data-maket-bind="state.title"><select data-maket-bind="state.status"><option value="open">Ouvert</option><option value="complete">Terminé</option></select>',
				},
			],
		});
		const schema = {
			type: "object",
			properties: {
				done: { type: "boolean" },
				title: { type: "string" },
				status: { type: "string", enum: ["open", "complete"] },
			},
			required: ["done", "title", "status"],
		};
		const stateRenderer = createStateRenderer({
			documentStates: {
				get: () => ({
					definition: { documentId: doc.id, schema, createdAt: "" },
					current: {
						documentId: doc.id,
						revision: 1,
						schema,
						data: { done: true, title: "Site audit", status: "complete" },
						createdAt: "",
					},
				}),
			},
		});
		const documentRenderer = createDocumentRenderer({
			collectionRenderer: { render: (value) => value },
			stateRenderer,
		});
		const service = createPdfService({
			documents,
			config: { ASSETS_DIR: tmp } as unknown as Config,
			assets,
			documentRenderer,
			browserPool: {
				get: async () => ({ newPage: async () => page }) as never,
				dispose: async () => {},
			},
		});

		await service.render(doc);

		const pdfHtml = setContent.mock.calls[0]?.[0];
		expect(pdfHtml).toMatch(/<input[^>]*data-maket-path="\/done"[^>]* checked/);
		expect(pdfHtml).toMatch(
			/<input[^>]*type="text"[^>]*data-maket-path="\/title"[^>]*value="Site audit"/,
		);
		expect(pdfHtml).toContain(
			'<option value="complete" selected>Terminé</option>',
		);
		expect(setContent).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ waitUntil: "load" }),
		);
		store.close();
		rmSync(tmp, { recursive: true, force: true });
	});

	it("rejects documents with no page HTML", async () => {
		const { service, cleanup } = fixture();
		await expect(service.render(makeDoc())).rejects.toThrow(
			/No pages with HTML content/,
		);
		cleanup();
	});

	it("propagates browser-launch failures", async () => {
		const { service, browserLaunch, cleanup } = fixture();
		const doc = makeDoc({
			pages: [
				{
					id: "page-p",
					name: "P",
					elements: [],
					html: `<div data-id="x">x</div>`,
				},
			],
		});
		await expect(service.render(doc)).rejects.toThrow(/no browser in tests/);
		expect(browserLaunch).toHaveBeenCalled();
		cleanup();
	});

	it("follows the page cursors by default and forces modes on demand", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "maket-pdf-"));
		const store = createSQLiteStore(":memory:");
		const documents = createDocuments({ store });
		const assets = createAssetsService({ assetsDir: tmp });
		const config = { ASSETS_DIR: tmp } as unknown as Config;
		const renderDocument = vi.fn((doc: Document) => doc);
		const service = createPdfService(
			{
				documents,
				config,
				assets,
				browserPool: {
					get: async () => Promise.reject(new Error("stop")),
					dispose: async () => {},
				},
				documentRenderer: { render: renderDocument },
				collectionCursors: {
					resolve: (docName, pageIndex) => ({
						docName,
						pageIndex,
						collection: "clients",
						mode: "rendered",
						memberId: "member_2",
					}),
				},
			},
			{
				browserLaunch: async () => {
					throw new Error("no browser in tests");
				},
			},
		);
		const doc = makeDoc({
			dataModel: "collection",
			pages: [
				{
					id: "page-p",
					name: "P",
					elements: [],
					html: `<div data-id="x">x</div>`,
					collection: { name: "clients" },
				},
			],
		});

		await expect(service.render(doc)).rejects.toThrow(/no browser in tests/);
		expect(renderDocument).toHaveBeenLastCalledWith(doc, {
			collection: {
				pages: { "page-p": { mode: "rendered", memberId: "member_2" } },
			},
		});

		await expect(service.render(doc, "print", "all")).rejects.toThrow(
			/no browser in tests/,
		);
		expect(renderDocument).toHaveBeenLastCalledWith(doc, {
			collection: {
				pages: { "page-p": { mode: "all", memberId: "member_2" } },
			},
		});
		store.close();
		rmSync(tmp, { recursive: true, force: true });
	});
});
