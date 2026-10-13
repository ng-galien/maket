import { renderDocumentStatePage } from "@maket/shared";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { decodeBundle } from "../lib/maket-format.js";
import { createDocument, type Document } from "../types.js";
import { createBundleExportService } from "./bundle-export.js";
import { createBus } from "./bus.js";
import { createCollections } from "./collections.js";
import type { Config } from "./config.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createStateRenderSlots } from "./state-render-slots.js";
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

describe("bundle export — render slots", () => {
	it("freezes the drawn SVG of every slot so the static reader shows the diagram", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const doc = createDocument({
			name: "Release flow",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "Flow",
					elements: [],
					html: '<h1>{{state.title}}</h1><div data-maket-render="mermaid" data-maket-from="state.flow"></div>',
				},
			],
		});
		documents.all().set(doc.name, doc);
		documents.persist(doc.name);
		const documentStates = createDocumentStates({ store, bus, documents });
		const schema = {
			type: "object",
			properties: {
				title: { type: "string" },
				flow: { type: "string", format: "maket-mermaid" },
			},
		};
		const data = {
			title: "Release",
			flow: "flowchart LR\n  Draft --> Signed",
		};
		documentStates.initialize(doc.name, schema, data);
		documents.persist(doc.name);
		const service = createBundleExportService({
			documents,
			documentRenderer: { render: (document) => document },
			collections: createCollections({ bus, documents, store }),
			store,
			config: { EXPORTS_DIR: "/tmp" } as unknown as Config,
			stateRenderSlots: createStateRenderSlots({ documents }),
		});

		const result = await service.build({
			names: [doc.name],
			includeAssets: false,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const bundle = await decodeBundle(result.buffer);
		const exported = bundle.documents[0];
		const snapshot = bundle.documentStates[0];
		expect(exported?.pages[0]?.html).toBe(doc.pages[0]?.html);
		expect(snapshot?.data).toEqual(data);
		expect(Object.keys(snapshot?.renderedSlots ?? {})).toEqual(["/flow"]);

		const readerHtml = renderDocumentStatePage(
			exported?.pages[0] ?? {},
			snapshot?.data ?? {},
			{
				schema: snapshot?.schema,
				renderSlot: (slot) => snapshot?.renderedSlots?.[slot.pointer] ?? "",
			},
		).html;
		const { document } = parseHTML(`<html><body>${readerHtml}</body></html>`);
		const slot = document.querySelector('[data-maket-render="mermaid"]');
		expect(slot?.querySelector("svg")).not.toBeNull();
		expect(slot?.textContent).toContain("Signed");
		store.close();
	});
});
