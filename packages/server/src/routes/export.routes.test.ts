import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocuments, type Documents } from "../services/documents.js";
import type { PdfService } from "../services/pdf.js";
import { createSQLiteStore, type Store } from "../services/store.js";
import { createDocument } from "../types.js";
import { createExportRouter } from "./export.routes.js";

describe("export routes — .maket bundle", () => {
	let store: Store;
	let documents: Documents;
	let baseUrl: string;
	let close: () => Promise<void>;

	beforeEach(async () => {
		store = createSQLiteStore(":memory:");
		const bus = createBus();
		documents = createDocuments({ store });
		// PDF service is unused by the new routes, but the factory wants it.
		const pdfService = {
			render: async () => ({ buffer: Buffer.alloc(0), pageCount: 0 }),
		} as unknown as PdfService;

		const app = express();
		app.use(createExportRouter({ documents, pdfService, store, bus }));
		const server = await new Promise<ReturnType<typeof app.listen>>(
			(resolve) => {
				const s = app.listen(0, () => resolve(s));
			},
		);
		const port = (server.address() as AddressInfo).port;
		baseUrl = `http://127.0.0.1:${port}`;
		close = () =>
			new Promise((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			);
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

	it("GET /api/export-maket?name=... streams a gzipped bundle that re-imports", async () => {
		store.saveDoc(makeDoc("poster"));
		store.saveCharte({
			name: "brand",
			tokens: { color: { primary: "#abc" } },
		});
		documents.loadAll();

		const res = await fetch(`${baseUrl}/api/export-maket?name=poster`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/gzip");
		const buf = Buffer.from(await res.arrayBuffer());
		expect(buf[0]).toBe(0x1f);
		expect(buf[1]).toBe(0x8b);

		// Re-import via POST on the same server — the doc must collide-rename
		const importRes = await fetch(`${baseUrl}/api/import-maket`, {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: buf,
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
			body: Buffer.from("not a gzip"),
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
			}),
		);
		const server2 = await new Promise<ReturnType<typeof app2.listen>>(
			(resolve) => {
				const s = app2.listen(0, () => resolve(s));
			},
		);
		const port2 = (server2.address() as AddressInfo).port;
		const importRes = await fetch(
			`http://127.0.0.1:${port2}/api/import-maket`,
			{
				method: "POST",
				headers: { "Content-Type": "application/gzip" },
				body: buf,
			},
		);
		expect(importRes.status).toBe(200);
		const json = (await importRes.json()) as {
			documents: string[];
			chartesAdded: string[];
		};
		expect(json.documents.sort()).toEqual(["a", "b"]);
		expect(json.chartesAdded).toEqual(["brand"]);
		await new Promise<void>((resolve, reject) =>
			server2.close((err) => (err ? reject(err) : resolve())),
		);
		store2.close();
	});
});
