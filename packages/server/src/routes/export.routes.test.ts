import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collection } from "@maket/shared";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../../tests/helpers.js";
import {
	decodeBundle,
	encodeBundleV1,
	encodeBundleV2,
} from "../lib/maket-format.js";
import {
	type BundleExportService,
	createBundleExportService,
} from "../services/bundle-export.js";
import {
	type BundleImportService,
	createBundleImportService,
} from "../services/bundle-import.js";
import { createBus } from "../services/bus.js";
import {
	type CollectionRenderer,
	createCollectionRenderer,
} from "../services/collection-renderer.js";
import {
	type Collections,
	createCollections,
} from "../services/collections.js";
import type { Config } from "../services/config.js";
import {
	createDocumentRenderer,
	type DocumentRenderer,
} from "../services/document-renderer.js";
import {
	createDocumentStates,
	type DocumentStates,
} from "../services/document-states.js";
import { createDocuments, type Documents } from "../services/documents.js";
import type { PdfService } from "../services/pdf.js";
import { createPending } from "../services/pending.js";
import { createStateRenderer } from "../services/state-renderer.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { createMaketDocTool } from "../tools/documents.js";
import { createDocument } from "../types.js";
import { createExportRouter } from "./export.routes.js";

const NO_EXTRA = {} as any;
const HISTORICAL_V1_BUNDLE = Buffer.from(
	readFileSync(
		new URL("./fixtures/historical-v1.maket.b64", import.meta.url),
		"utf8",
	).trim(),
	"base64",
);

describe("export routes — .maket bundle", () => {
	let store: Store;
	let documents: Documents;
	let collections: Collections;
	let collectionRenderer: CollectionRenderer;
	let documentRenderer: DocumentRenderer;
	let documentStates: DocumentStates;
	let bundleExportService: BundleExportService;
	let bundleImportService: BundleImportService;
	let config: Config;
	let testDir: string;
	let baseUrl: string;
	let close: () => Promise<void>;
	let bus: ReturnType<typeof createBus>;
	let pdfService: { render: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		testDir = mkdtempSync(join(tmpdir(), "maket-export-routes-"));
		const assetsDir = join(testDir, "assets");
		const exportsDir = join(testDir, "exports");
		mkdirSync(assetsDir);
		mkdirSync(exportsDir);
		config = {
			DATA_DIR: testDir,
			ASSETS_DIR: assetsDir,
			EXPORTS_DIR: exportsDir,
			DOCS_DIR: join(testDir, "documents"),
		} as Config;
		store = createSQLiteStore(":memory:");
		bus = createBus();
		documents = createDocuments({ store });
		collections = createCollections({ bus, documents, store });
		collectionRenderer = createCollectionRenderer({ collections });
		documentStates = createDocumentStates({ bus, documents, store });
		documentRenderer = createDocumentRenderer({
			collectionRenderer,
			stateRenderer: createStateRenderer({ documentStates }),
		});
		bundleExportService = createBundleExportService({
			documents,
			collections,
			store,
			config,
		});
		bundleImportService = createBundleImportService({
			documents,
			documentStates,
			store,
			bus,
			config,
		});
		pdfService = {
			render: vi.fn(async () => ({
				buffer: Buffer.from("%PDF-test"),
				pageCount: 1,
			})),
		};

		const app = express();
		app.use(
			createExportRouter({
				documents,
				bundleExportService,
				bundleImportService,
				documentRenderer,
				pdfService: pdfService as unknown as PdfService,
			}),
		);
		({ baseUrl, close } = await startTestApp(app));
	});

	afterEach(async () => {
		await close();
		store.close();
		rmSync(testDir, { recursive: true, force: true });
	});

	function makeDoc(name: string) {
		return createDocument({
			name,
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			meta: { charte: "brand" },
			pages: [
				{ name: "P1", elements: [], html: `<div data-id="e0">${name}</div>` },
			],
		});
	}

	function makeCollection(): Collection {
		return {
			name: "clients",
			schema: {
				type: "object",
				properties: { client_name: { type: "string" } },
			},
			members: [
				{ id: "member_1", position: 0, data: { client_name: "Acme" } },
				{ id: "member_2", position: 1, data: { client_name: "Globex" } },
			],
		};
	}

	it("GET /api/export-maket?name=... streams a v2 ZIP bundle that re-imports", async () => {
		store.saveDoc(makeDoc("poster"));
		store.saveCharte({
			name: "brand",
			tokens: { color: { primary: "#abc" } },
		});
		documents.loadAll();

		const res = await fetch(`${baseUrl}/api/export-maket?name=poster`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/zip");
		const buf = Buffer.from(await res.arrayBuffer());
		// ZIP magic bytes
		expect(buf[0]).toBe(0x50);
		expect(buf[1]).toBe(0x4b);

		// Re-import via POST on the same server — the doc must collide-rename
		const importRes = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/zip" },
			body: new Uint8Array(buf),
		});
		expect(importRes.status).toBe(200);
		const json = (await importRes.json()) as {
			documents: string[];
			renamed: { from: string; to: string }[];
			chartesSkipped: string[];
		};
		expect(json.documents).toEqual(["poster (imported)"]);
		expect(json.renamed).toEqual([{ from: "poster", to: "poster (imported)" }]);
		expect(json.chartesSkipped).toEqual(["brand"]);
	});

	it("round-trips a state-backed document as a fresh current snapshot", async () => {
		const doc = makeDoc("living-checklist");
		const page = doc.pages[0];
		if (!page) throw new Error("Expected fixture page");
		page.html = "<h1>{{ state.title }}</h1>";
		store.saveDoc(doc);
		documents.loadAll();
		documentStates.initialize(
			"living-checklist",
			{
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			{ title: "Draft" },
		);
		documentStates.update("living-checklist", 1, { title: "Current" });

		const exportRes = await fetch(
			`${baseUrl}/api/export-maket?name=living-checklist`,
		);
		expect(exportRes.status).toBe(200);
		const importRes = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/zip" },
			body: new Uint8Array(await exportRes.arrayBuffer()),
		});
		expect(importRes.status).toBe(200);
		expect(await importRes.json()).toEqual(
			expect.objectContaining({
				documents: ["living-checklist (imported)"],
				statesImported: 1,
			}),
		);
		const imported = documents.resolveOrLoad("living-checklist (imported)");
		expect(imported?.dataModel).toBe("state");
		const state = documentStates.get("living-checklist (imported)");
		expect(state?.current).toEqual(
			expect.objectContaining({ revision: 1, data: { title: "Current" } }),
		);
		expect(documentStates.history("living-checklist (imported)")).toHaveLength(
			1,
		);
	});

	it("produces the same complete bundle through HTTP and MCP", async () => {
		const living = makeDoc("living-poster");
		const livingPage = living.pages[0];
		if (!livingPage) throw new Error("Expected living document page");
		livingPage.html = '<img src="/assets/logo.png"><h1>{{ state.title }}</h1>';

		const collectionDocument = makeDoc("client-poster");
		const collectionPage = collectionDocument.pages[0];
		if (!collectionPage) throw new Error("Expected collection document page");
		collectionDocument.dataModel = "collection";
		collectionPage.collection = { name: "clients" };
		collectionPage.html = "<h1>{{ client_name }}</h1>";

		const collection = makeCollection();
		store.saveDoc(living);
		store.saveDoc(collectionDocument);
		store.saveCharte({
			name: "brand",
			tokens: { color: { primary: "#123456" } },
		});
		store.saveCollection(collection);
		writeFileSync(join(config.ASSETS_DIR, "logo.png"), Buffer.from("logo"));
		documents.loadAll();
		documentStates.initialize(
			"living-poster",
			{
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			{ title: "Current" },
		);

		const httpResponse = await fetch(
			`${baseUrl}/api/export-maket?names=living-poster,client-poster`,
		);
		expect(httpResponse.status).toBe(200);
		const httpBundle = await decodeBundle(
			Buffer.from(await httpResponse.arrayBuffer()),
		);

		const tool = createMaketDocTool({
			documents,
			bus,
			store,
			config,
			pending: createPending({ bus }),
			bundleExportService,
			bundleImportService,
		});
		const mcpResponse = await tool.handler(
			{
				action: "export",
				docs: ["living-poster", "client-poster"],
				output: "mcp-parity",
			},
			NO_EXTRA,
		);
		expect(mcpResponse.isError).toBeUndefined();
		const mcpText = (mcpResponse.content[0] as { text: string }).text;
		const mcpPath = mcpText.match(/→ (\S+\.maket)/)?.[1];
		expect(mcpPath).toBeDefined();
		const mcpBundle = await decodeBundle(readFileSync(mcpPath as string));

		const { exportedAt: _httpExportedAt, ...httpPortableContent } = httpBundle;
		const { exportedAt: _mcpExportedAt, ...mcpPortableContent } = mcpBundle;
		expect(mcpPortableContent).toEqual(httpPortableContent);
		expect(mcpBundle.documents).toHaveLength(2);
		expect(mcpBundle.chartes).toHaveLength(1);
		expect(mcpBundle.collections).toEqual([collection]);
		expect(mcpBundle.documentStates).toEqual([
			expect.objectContaining({
				documentId: living.id,
				data: { title: "Current" },
			}),
		]);
		expect(mcpBundle.assets).toEqual([
			{ relPath: "logo.png", bytes: Buffer.from("logo") },
		]);

		const importResponse = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/zip" },
			body: new Uint8Array(readFileSync(mcpPath as string)),
		});
		expect(importResponse.status).toBe(200);
		expect(await importResponse.json()).toEqual(
			expect.objectContaining({
				chartesSkipped: ["brand"],
				collectionsSkipped: ["clients"],
				assetsWritten: 0,
				assetsSkipped: 1,
				statesImported: 1,
			}),
		);
		expect(readFileSync(join(config.ASSETS_DIR, "logo.png"), "utf8")).toBe(
			"logo",
		);

		const structureOnlyResponse = await tool.handler(
			{
				action: "export",
				docs: ["living-poster", "client-poster"],
				output: "mcp-structure-only",
				include_assets: false,
			},
			NO_EXTRA,
		);
		const structureOnlyText = (
			structureOnlyResponse.content[0] as { text: string }
		).text;
		const structureOnlyPath = structureOnlyText.match(/→ (\S+\.maket)/)?.[1];
		expect(structureOnlyPath).toBeDefined();
		const structureOnlyBundle = await decodeBundle(
			readFileSync(structureOnlyPath as string),
		);
		expect(structureOnlyBundle.assets).toEqual([]);
	});

	it("maps a missing export document at both public boundaries", async () => {
		const httpResponse = await fetch(
			`${baseUrl}/api/export-maket?name=missing`,
		);
		expect(httpResponse.status).toBe(404);
		expect(await httpResponse.json()).toEqual({
			error: "Documents not found: missing",
		});

		const tool = createMaketDocTool({
			documents,
			bus,
			store,
			config,
			pending: createPending({ bus }),
			bundleExportService,
			bundleImportService,
		});
		const mcpResponse = await tool.handler(
			{ action: "export", doc: "missing" },
			NO_EXTRA,
		);
		expect(mcpResponse.isError).toBe(true);
		expect((mcpResponse.content[0] as { text: string }).text).toBe(
			"Documents not found: missing",
		);
	});

	it("POST /api/import-maket rejects garbage payloads", async () => {
		const res = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: new Uint8Array(Buffer.from("not a gzip")),
		});
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toHaveProperty("error");
	});

	it("POST /api/import-maket imports a frozen Maket 1.2 v1 bundle", async () => {
		const response = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: new Uint8Array(HISTORICAL_V1_BUNDLE),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(
			expect.objectContaining({
				version: 1,
				documents: ["legacy-poster"],
				chartesAdded: ["legacy-brand"],
			}),
		);
		expect(documents.resolveOrLoad("legacy-poster")).toEqual(
			expect.objectContaining({ name: "legacy-poster", category: "archive" }),
		);
	});

	it("POST /api/import-maket reports charte persistence failures", async () => {
		const saveCharte = vi
			.spyOn(store, "saveCharte")
			.mockImplementationOnce(() => {
				throw new Error("charte database is read-only");
			});
		const bundle = encodeBundleV1(
			[makeDoc("charte-import")],
			[{ name: "imported-brand", tokens: {} }],
		);

		const response = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: new Uint8Array(bundle),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error:
				'Could not import charte "imported-brand": charte database is read-only',
		});
		saveCharte.mockRestore();
	});

	it("POST /api/import-maket reports collection persistence failures", async () => {
		const saveCollection = vi
			.spyOn(store, "saveCollection")
			.mockImplementationOnce(() => {
				throw new Error("collection database is read-only");
			});
		const bundle = await encodeBundleV2(
			[makeDoc("collection-import")],
			[],
			[makeCollection()],
			[],
		);

		const response = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/zip" },
			body: new Uint8Array(bundle),
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error:
				'Could not import collection "clients": collection database is read-only',
		});
		saveCollection.mockRestore();
	});

	it("GET /api/export-maket with no docs 400s on an empty workspace", async () => {
		const res = await fetch(`${baseUrl}/api/export-maket`);
		expect(res.status).toBe(400);
	});

	it("GET /api/export-maket?names=a,b exports multiple docs", async () => {
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		store.saveCharte({ name: "brand", tokens: {} });
		documents.loadAll();

		const res = await fetch(`${baseUrl}/api/export-maket?names=a,b`);
		expect(res.status).toBe(200);
		const buf = Buffer.from(await res.arrayBuffer());
		expect(buf.length).toBeGreaterThan(20);
		// Round-trip by re-importing into a fresh workspace
		const store2 = createSQLiteStore(":memory:");
		const documents2 = createDocuments({ store: store2 });
		const bus2 = createBus();
		const documentStates2 = createDocumentStates({
			bus: bus2,
			documents: documents2,
			store: store2,
		});
		const collections2 = createCollections({
			bus: bus2,
			documents: documents2,
			store: store2,
		});
		const pdfService2 = {
			render: async () => ({ buffer: Buffer.alloc(0), pageCount: 0 }),
		} as unknown as PdfService;
		const config2 = {
			DATA_DIR: "/tmp",
			ASSETS_DIR: "/tmp/maket-test-assets-2",
			EXPORTS_DIR: "/tmp/maket-test-exports-2",
			DOCS_DIR: "/tmp/maket-test-docs-2",
		} as never;
		const app2 = express();
		app2.use(
			createExportRouter({
				documents: documents2,
				bundleExportService: createBundleExportService({
					documents: documents2,
					collections: collections2,
					store: store2,
					config: config2,
				}),
				bundleImportService: createBundleImportService({
					documents: documents2,
					documentStates: documentStates2,
					store: store2,
					bus: bus2,
					config: config2,
				}),
				pdfService: pdfService2,
			}),
		);
		const { baseUrl: baseUrl2, close: close2 } = await startTestApp(app2);
		const importRes = await fetch(`${baseUrl2}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: new Uint8Array(buf),
		});
		expect(importRes.status).toBe(200);
		const json = (await importRes.json()) as {
			documents: string[];
			chartesAdded: string[];
		};
		expect(json.documents.sort()).toEqual(["a", "b"]);
		expect(json.chartesAdded).toEqual(["brand"]);
		await close2();
		store2.close();
	});

	it("rejects browser requests with a non-loopback Referer", async () => {
		store.saveDoc(makeDoc("poster"));
		documents.loadAll();

		const res = await fetch(`${baseUrl}/api/export-maket?name=poster`, {
			headers: { Referer: "https://evil.example/" },
		});

		expect(res.status).toBe(403);
	});

	it("GET /print renders HTML with the auto-print script", async () => {
		store.saveDoc(makeDoc("poster"));
		documents.loadAll();

		const res = await fetch(`${baseUrl}/print?name=poster`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const html = await res.text();
		expect(html).toContain("window.print()");
		expect(html).toContain('data-id="e0"');
		expect(html).toContain("poster");
	});

	it("GET /print follows the selected collection row", async () => {
		const doc = makeDoc("poster");
		const page = doc.pages[0];
		if (!page) throw new Error("Expected fixture page");
		page.collection = { name: "clients" };
		doc.dataModel = "collection";
		page.html = '<div data-id="e0">{{ client_name }}</div>';
		store.saveDoc(doc);
		store.saveCollection(makeCollection());
		documents.loadAll();
		const selection = encodeURIComponent(
			JSON.stringify({
				clients: { mode: "rendered", memberId: "member_2" },
			}),
		);

		const res = await fetch(
			`${baseUrl}/print?name=poster&collection_preview=${selection}`,
		);

		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Globex");
		expect(html).not.toContain("Acme");
		expect(html).not.toContain("{{ client_name }}");
	});

	it("GET /print follows the all rows collection mode", async () => {
		const doc = makeDoc("poster");
		const page = doc.pages[0];
		if (!page) throw new Error("Expected fixture page");
		page.collection = { name: "clients" };
		doc.dataModel = "collection";
		page.html = '<div data-id="e0">{{ client_name }}</div>';
		store.saveDoc(doc);
		store.saveCollection(makeCollection());
		documents.loadAll();
		const selection = encodeURIComponent(
			JSON.stringify({
				clients: { mode: "all", memberId: "member_2" },
			}),
		);

		const res = await fetch(
			`${baseUrl}/print?name=poster&collection_preview=${selection}`,
		);

		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Acme");
		expect(html).toContain("Globex");
	});

	it("GET /print renders the current document-state snapshot without collection expansion", async () => {
		const doc = makeDoc("living-checklist");
		const page = doc.pages[0];
		if (!page) throw new Error("Expected fixture page");
		page.html =
			'<div data-id="e0">{{ state.title }} — {{ state.status }}</div><input type="text" data-maket-bind="state.title"><select data-maket-bind="state.status"><option value="open">Ouvert</option><option value="complete">Terminé</option></select><label><input type="checkbox" data-maket-bind="state.done"> Done</label>';
		store.saveDoc(doc);
		documents.loadAll();
		documentStates.initialize(
			"living-checklist",
			{
				type: "object",
				properties: {
					title: { type: "string" },
					status: { type: "string", enum: ["open", "complete"] },
					done: { type: "boolean" },
				},
				required: ["title", "status", "done"],
			},
			{ title: "Site audit", status: "open", done: false },
		);
		documentStates.update("living-checklist", 1, {
			title: "Site audit",
			status: "complete",
			done: true,
		});

		const res = await fetch(`${baseUrl}/print?name=living-checklist`);

		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Site audit — complete");
		expect(html).toContain('data-maket-path="/done"');
		expect(html).toMatch(/<input[^>]* checked/);
		expect(html).toMatch(
			/<input[^>]*type="text"[^>]*data-maket-path="\/title"[^>]*value="Site audit"/,
		);
		expect(html).toContain(
			'<option value="complete" selected>Terminé</option>',
		);
		expect(html).not.toContain('<option value="open" selected>Ouvert</option>');
		expect(html).not.toContain("{{ state.");
		expect(page.html).toContain('data-maket-bind="state.done"');
		expect(page.html).not.toContain("data-maket-path");
		expect(page.html).not.toContain("data-maket-type");
		expect((html.match(/class="page"/g) ?? []).length).toBe(1);
	});

	it("GET /api/export-pdf streams the rendered PDF with the default quality", async () => {
		store.saveDoc(makeDoc("poster"));
		documents.loadAll();

		const res = await fetch(`${baseUrl}/api/export-pdf?name=poster`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(res.headers.get("content-disposition")).toContain("poster.pdf");
		expect(pdfService.render).toHaveBeenCalledWith(
			expect.objectContaining({ name: "poster" }),
			"print",
		);
		expect(Buffer.from(await res.arrayBuffer()).toString("utf-8")).toBe(
			"%PDF-test",
		);
	});

	it("GET /api/export-pdf returns 500 when rendering fails", async () => {
		store.saveDoc(makeDoc("poster"));
		documents.loadAll();
		pdfService.render.mockRejectedValueOnce(new Error("pdf failed"));

		const res = await fetch(`${baseUrl}/api/export-pdf?name=poster`);

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: "pdf failed" });
	});

	it("POST /api/import-maket strips active HTML from imported pages", async () => {
		const unsafe = createDocument({
			name: "unsafe",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "P1",
					elements: [],
					html: `<div data-id="safe">ok</div><img data-id="img" src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script>`,
				},
			],
		});
		const buf = encodeBundleV1([unsafe], []);

		const res = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: new Uint8Array(buf),
		});

		expect(res.status).toBe(200);
		const saved = documents.resolveOrLoad("unsafe");
		expect(saved?.pages[0]?.html).toContain(`data-id="safe">ok</div>`);
		expect(saved?.pages[0]?.html).not.toContain("<script");
		expect(saved?.pages[0]?.html).not.toContain("onerror=");
		expect(saved?.pages[0]?.html).not.toContain("javascript:");
	});
});
