import type { Collection } from "@maket/shared";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp } from "../../tests/helpers.js";
import { encodeBundleV1 } from "../lib/maket-format.js";
import { createBus } from "../services/bus.js";
import {
	type Collections,
	createCollections,
} from "../services/collections.js";
import { createDocuments, type Documents } from "../services/documents.js";
import type { PdfService } from "../services/pdf.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { createDocument } from "../types.js";
import { createExportRouter } from "./export.routes.js";

describe("export routes — .maket bundle", () => {
	let store: Store;
	let documents: Documents;
	let collections: Collections;
	let baseUrl: string;
	let close: () => Promise<void>;
	let bus: ReturnType<typeof createBus>;
	let pdfService: { render: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		store = createSQLiteStore(":memory:");
		bus = createBus();
		documents = createDocuments({ store });
		collections = createCollections({ bus, documents, store });
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
				collections,
				pdfService: pdfService as unknown as PdfService,
				store,
				bus,
				config: {
					DATA_DIR: "/tmp",
					ASSETS_DIR: "/tmp/maket-test-assets",
					EXPORTS_DIR: "/tmp/maket-test-exports",
					DOCS_DIR: "/tmp/maket-test-docs",
				} as never,
			}),
		);
		({ baseUrl, close } = await startTestApp(app));
	});

	afterEach(async () => {
		await close();
		store.close();
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

	it("POST /api/import-maket rejects garbage payloads", async () => {
		const res = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: new Uint8Array(Buffer.from("not a gzip")),
		});
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toHaveProperty("error");
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
		const pdfService2 = {
			render: async () => ({ buffer: Buffer.alloc(0), pageCount: 0 }),
		} as unknown as PdfService;
		const app2 = express();
		app2.use(
			createExportRouter({
				documents: documents2,
				pdfService: pdfService2,
				store: store2,
				bus: bus2,
				config: {
					DATA_DIR: "/tmp",
					ASSETS_DIR: "/tmp/maket-test-assets-2",
					EXPORTS_DIR: "/tmp/maket-test-exports-2",
					DOCS_DIR: "/tmp/maket-test-docs-2",
				} as never,
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
