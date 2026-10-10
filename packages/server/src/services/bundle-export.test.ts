import { describe, expect, it, vi } from "vitest";
import { createDocument, type Document } from "../types.js";
import { createBundleExportService } from "./bundle-export.js";
import { createBus } from "./bus.js";
import { createCollections } from "./collections.js";
import type { Config } from "./config.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";

describe("bundle export — Workspace collection copies", () => {
	it("exports a flowed collection page as authored pages after its flow is measured", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const index = createDocument({
			name: "Delivery — Backlog",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			meta: {
				structuredWorkspace: {
					role: "collection",
					workspaceId: "ws-1",
					collectionId: "backlog",
				},
			},
			pages: [{ name: "Index", elements: [], html: "<main></main>" }],
		});
		store.saveDoc(index);
		documents.loadAll();
		const pageId = index.pages[0]?.id ?? "";
		const flowed = (document: Document): Document => ({
			...document,
			pages: [0, 1].map((rank) => ({
				id: rank === 0 ? pageId : `${pageId}~2`,
				name: rank === 0 ? "Index" : "Index (2)",
				elements: [],
				html: `<main>${rank + 1}</main>`,
				flow: { sourcePageId: pageId, index: rank, count: 2 },
			})),
		});
		const renderSettled = vi.fn(async (document: Document) => flowed(document));
		const service = createBundleExportService({
			documents,
			documentRenderer: {
				render: (document) => document,
				renderSettled,
			},
			collections: createCollections({ bus, documents, store }),
			store,
			config: { EXPORTS_DIR: "/tmp" } as unknown as Config,
		});

		const result = await service.build({ names: ["Delivery — Backlog"] });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(renderSettled).toHaveBeenCalledTimes(1);
		const pages = result.documents[0]?.pages ?? [];
		expect(pages.map((page) => page.html)).toEqual([
			"<main>1</main>",
			"<main>2</main>",
		]);
		expect(pages[0]?.id).toBe(pageId);
		expect(pages[1]?.id).not.toContain("~");
		expect(pages.every((page) => page.flow === undefined)).toBe(true);
		store.close();
	});
});
