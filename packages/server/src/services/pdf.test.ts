import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "../types.js";
import { createAssetsService } from "./assets.js";
import type { Config } from "./config.js";
import { createDocumentRenderer } from "./document-renderer.js";
import { createDocuments } from "./documents.js";
import { buildPrintHtml, createPdfService } from "./pdf.js";
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

describe("buildPrintHtml", () => {
	it("wraps each page in a private render frame and inserts @page size", () => {
		const doc = makeDoc();
		const out = buildPrintHtml({
			source: doc,
			rendered: doc,
			pageHtmls: [`<p data-id="a">A</p>`, `<p data-id="b">B</p>`],
			charteCss: "",
		});
		expect(out).toMatch(/@page \{ size: 210mm 297mm/);
		expect(out).toMatch(/<maket-render-page/);
		// Second page starts with page-break-before
		expect(out).toMatch(/page-break-before:always/);
	});

	it("turns page links into anchors of the printed pages", () => {
		const cover = {
			id: "cover",
			name: "Cover",
			elements: [],
			html: '<a data-id="to-detail" href="#page:Détails">Détails</a><a data-id="to-cards" href="#page=2">Cards</a><a data-id="lost" href="#page=9">Lost</a>',
		};
		const detail = {
			id: "detail",
			name: "Détails",
			elements: [],
			html: '<a data-id="back" href="#page=1">Back</a>',
		};
		const source = makeDoc({
			pages: [
				cover,
				{ id: "cards", name: "Cards", elements: [], html: "<p>{{name}}</p>" },
				detail,
			],
		});
		const rendered = makeDoc({
			pages: [
				cover,
				{ id: "cards:people:a", elements: [], html: "<p>A</p>" },
				{ id: "cards:people:b", elements: [], html: "<p>B</p>" },
				detail,
			],
		});
		const out = buildPrintHtml({
			source,
			rendered,
			pageHtmls: rendered.pages.map((page) => page.html ?? ""),
			charteCss: "",
		});

		for (const number of [1, 2, 3, 4]) {
			expect(out).toContain(
				`<maket-render-page id="maket-page-${number}" data-maket-render-page="${number}"`,
			);
		}
		expect(out).toContain('href="#maket-page-4"');
		expect(out).toContain('href="#maket-page-2"');
		expect(out).toContain('href="#maket-page-1"');
		expect(out).toContain('href="#page=9"');
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
			setViewport: vi.fn(async () => {}),
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
					definition: {
						documentId: doc.id,
						schema,
						createdAt: "",
						retention: null,
					},
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
			structuredWorkspaces: {
				renderCollection: () => {
					throw new Error("Unexpected Structured Workspace projection.");
				},
			},
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
