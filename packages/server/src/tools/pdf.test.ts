import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../services/config.js";
import { createDocuments } from "../services/documents.js";
import type { PdfService } from "../services/pdf.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketPdfTool, pdfPack } from "./pdf.js";

function fixture() {
	const tmp = mkdtempSync(join(tmpdir(), "maket-pdf-"));
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const config = { EXPORTS_DIR: tmp } as unknown as Config;
	const pdfService: PdfService = {
		render: vi.fn(async () => ({
			buffer: Buffer.from("%PDF-fake"),
			pageCount: 2,
		})),
	};
	return {
		store,
		documents,
		config,
		pdfService,
		tmp,
		cleanup: () => {
			store.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque
const NO_EXTRA = {} as any;

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
		pages: [
			{ name: "P1", elements: [], html: `<div data-id="a">A</div>` },
			{ name: "P2", elements: [], html: `<div data-id="b">B</div>` },
		],
	});
}

describe("pdfPack — registration", () => {
	it("declares id and deps", () => {
		expect(pdfPack.id).toBe("pdf");
		expect(pdfPack.requires).toEqual(
			expect.arrayContaining(["documents", "pdfService", "config"]),
		);
	});
});

describe("maket_pdf", () => {
	it("renders via pdfService and writes the PDF to EXPORTS_DIR", async () => {
		const { store, documents, config, pdfService, tmp, cleanup } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();

		const tool = createMaketPdfTool({
			documents,
			pdfService,
			config,
		});
		const res = await tool.handler({ doc: "d" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		expect(pdfService.render).toHaveBeenCalledWith(
			expect.objectContaining({ name: "d" }),
			"print",
		);
		// file landed on disk
		const data = readFileSync(join(tmp, "d.pdf"));
		expect(data.toString()).toMatch(/%PDF-fake/);
		cleanup();
	});

	it("returns error when document missing", async () => {
		const { documents, config, pdfService, cleanup } = fixture();
		const tool = createMaketPdfTool({
			documents,
			pdfService,
			config,
		});
		const res = await tool.handler({ doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("converts render() throw into an MCP error", async () => {
		const { store, documents, config, cleanup } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const pdfService: PdfService = {
			render: vi.fn(async () => {
				throw new Error("boom");
			}),
		};
		const tool = createMaketPdfTool({
			documents,
			pdfService,
			config,
		});
		const res = await tool.handler({ doc: "d" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/PDF export failed: boom/);
		cleanup();
	});
});
