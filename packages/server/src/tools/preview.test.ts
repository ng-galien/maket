import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../services/config.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { DocumentModel } from "../types.js";
import { createMaketPreviewTool, previewPack } from "./preview.js";

function fixture() {
	const tmp = mkdtempSync(join(tmpdir(), "maket-preview-"));
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const config = { EXPORTS_DIR: tmp, PORT: 3333 } as unknown as Config;
	return {
		store,
		documents,
		config,
		cleanup: () => {
			store.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
const NO_EXTRA = {} as any;

describe("previewPack — registration", () => {
	it("declares id and deps", () => {
		expect(previewPack.id).toBe("preview");
		expect(previewPack.requires).toEqual(
			expect.arrayContaining(["documents", "config"]),
		);
	});
});

describe("maket_preview — action=snapshot", () => {
	it("errors when document is missing", async () => {
		const { documents, config, cleanup } = fixture();
		const tool = createMaketPreviewTool({ documents, config });
		const res = await tool.handler(
			{ action: "snapshot", doc: "ghost", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when page is out of range", async () => {
		const { store, documents, config, cleanup } = fixture();
		store.saveDoc(
			new DocumentModel({
				name: "d",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [{ name: "P1", elements: [], html: "<p>.</p>" }],
			}),
		);
		documents.loadAll();
		const tool = createMaketPreviewTool({ documents, config });
		const res = await tool.handler(
			{ action: "snapshot", doc: "d", page: 99 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when page has no HTML", async () => {
		const { store, documents, config, cleanup } = fixture();
		store.saveDoc(
			new DocumentModel({
				name: "d",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [{ name: "P1", elements: [] }],
			}),
		);
		documents.loadAll();
		const tool = createMaketPreviewTool({ documents, config });
		const res = await tool.handler(
			{ action: "snapshot", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when doc/page args are missing", async () => {
		const { documents, config, cleanup } = fixture();
		const tool = createMaketPreviewTool({ documents, config });
		const res = await tool.handler({ action: "snapshot" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});
});
