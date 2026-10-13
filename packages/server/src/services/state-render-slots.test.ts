import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { decodeBundle } from "../lib/maket-format.js";
import { type Charte, createDocument, type Document } from "../types.js";
import { createAssetsService } from "./assets.js";
import { createBundleExportService } from "./bundle-export.js";
import { createBus } from "./bus.js";
import { createCollections } from "./collections.js";
import type { Config } from "./config.js";
import { createDocumentRenderer } from "./document-renderer.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createPdfService } from "./pdf.js";
import { createStateRenderSlots } from "./state-render-slots.js";
import { createStateRenderer } from "./state-renderer.js";
import { createSQLiteStore } from "./store.js";
import { createThumbnailService } from "./thumbnail.js";

const doc = { name: "plan", meta: { charte: "brand" } } as unknown as Document;
const slot = (source: string) => ({
	kind: "mermaid" as const,
	source,
	pointer: "/flow",
});

function charte(accent: string, bg = "#0F172A"): Charte {
	return {
		name: "brand",
		tokens: { color: { background: bg, text: "#E2E8F0", accent } },
	};
}

describe("StateRenderSlots", () => {
	it("draws a Mermaid source as SVG with the document's charte", () => {
		const slots = createStateRenderSlots({
			documents: { charte: () => charte("#2563EB") },
		});
		const svg = slots.forDocument(doc)(slot("flowchart LR\n  A --> B"));
		expect(svg).toMatch(/^<svg[^>]*>/);
		expect(svg).toContain("#0F172A");
	});

	it("draws each source and charte once, and follows a charte change without any refresh", () => {
		let current = charte("#2563EB", "#0F172A");
		const charteOf = vi.fn(() => current);
		const slots = createStateRenderSlots({ documents: { charte: charteOf } });
		const first = slots.forDocument(doc)(slot("flowchart LR\n  A --> B"));
		expect(slots.forDocument(doc)(slot("flowchart LR\n  A --> B"))).toBe(first);
		current = charte("#2563EB", "#F8FAFC");
		const recoloured = slots.forDocument(doc)(slot("flowchart LR\n  A --> B"));
		expect(recoloured).not.toBe(first);
		expect(recoloured).toContain("#F8FAFC");
		expect(recoloured).not.toContain("#0F172A");
	});

	it("produces no active element from a source carrying script or event handlers", () => {
		const slots = createStateRenderSlots({ documents: { charte: () => null } });
		const svg = slots.forDocument(doc)(
			slot(
				'flowchart TD\n  A["<script>alert(1)</script>"] --> B["<img src=x onerror=alert(1)>"]',
			),
		);
		const { document } = parseHTML(`<html><body>${svg}</body></html>`);
		expect(document.querySelectorAll("svg")).toHaveLength(1);
		expect(
			document.querySelectorAll("script, img, iframe, [onerror], [onload]"),
		).toHaveLength(0);
	});

	it("shows a source it cannot draw as text instead of failing the render", () => {
		const slots = createStateRenderSlots({ documents: { charte: () => null } });
		expect(
			slots.forDocument(doc)(slot("flowchart TD\n  style A fill:#f00")),
		).toBe(
			'<p class="maket-render-error">Diagram error: Mermaid styling directives are not supported. Use charte tokens, tokenRefs, or safe diagram options instead.</p>',
		);
	});
});

describe("render slot injection probe", () => {
	const probe =
		"flowchart TD\n  P[\"</textarea><img src=x onerror=document.body.insertAdjacentText('afterbegin','INJECTED_JS_RAN')>\"] --> Q[\"<script>alert(1)</script>\"]";
	const schema = {
		type: "object",
		properties: { probe: { type: "string", format: "maket-mermaid" } },
	};
	const canvas = {
		format: "A5" as const,
		orientation: "landscape" as const,
		w: 210,
		h: 148,
		bg: "#fff",
	};

	function assertInert(html: string, where: string): void {
		expect(html, where).toContain("<svg");
		expect(html, where).not.toMatch(/<img|<script/i);
		const { document } = parseHTML(`<html><body>${html}</body></html>`);
		expect(document.querySelectorAll("img, script, iframe").length, where).toBe(
			0,
		);
		const handlers = [...document.querySelectorAll("*")].flatMap((element) =>
			[...element.attributes]
				.map((attribute) => attribute.name)
				.filter((name) => name.toLowerCase().startsWith("on")),
		);
		expect(handlers, where).toEqual([]);
	}

	it("refuses the probe slot inside a textarea and keeps every output of a slot inert", async () => {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const documentStates = createDocumentStates({ store, bus, documents });
		const stateRenderSlots = createStateRenderSlots({ documents });
		const inTextarea = createDocument({
			name: "Probe in textarea",
			canvas,
			pages: [
				{
					name: "P",
					elements: [],
					html: '<textarea><div data-maket-render="mermaid" data-maket-from="state.probe"></div></textarea>',
				},
			],
		});
		documents.all().set(inTextarea.name, inTextarea);
		documents.persist(inTextarea.name);
		expect(() =>
			documentStates.initialize(inTextarea.name, schema, { probe }),
		).toThrow("A render slot cannot be placed inside a <textarea> element");

		const doc = createDocument({
			name: "Probe",
			canvas,
			pages: [
				{
					name: "P",
					elements: [],
					html: '<div data-maket-render="mermaid" data-maket-from="state.probe"></div>',
				},
			],
		});
		documents.all().set(doc.name, doc);
		documents.persist(doc.name);
		documentStates.initialize(doc.name, schema, { probe });
		documents.persist(doc.name);
		const documentRenderer = createDocumentRenderer({
			collectionRenderer: { render: (value) => value },
			stateRenderer: createStateRenderer({ documentStates, stateRenderSlots }),
			structuredWorkspaces: {
				renderCollection: () => {
					throw new Error("Unexpected Structured Workspace projection.");
				},
			},
		});
		assertInert(documentRenderer.render(doc).pages[0]?.html ?? "", "page");

		const tmp = mkdtempSync(join(tmpdir(), "maket-probe-"));
		try {
			const config = { ASSETS_DIR: tmp, EXPORTS_DIR: tmp } as unknown as Config;
			const assets = createAssetsService({ assetsDir: tmp });
			const snapshot = vi.fn(async (_html: string) => Buffer.from("PNG"));
			await createThumbnailService(
				{
					documents,
					config,
					assets,
					documentRenderer,
					browserPool: {} as never,
				},
				{ snapshot },
			).render(doc);
			assertInert(snapshot.mock.calls[0]?.[0] ?? "", "thumbnail");

			const setContent = vi.fn(async (_html: string, _options?: unknown) => {});
			const page = {
				setRequestInterception: vi.fn(async () => {}),
				on: vi.fn(),
				setViewport: vi.fn(async () => {}),
				setContent,
				waitForNetworkIdle: vi.fn(async () => {}),
				evaluate: vi.fn(async () => {}),
				pdf: vi.fn(async () => new Uint8Array([1])),
				close: vi.fn(async () => {}),
			};
			await createPdfService({
				documents,
				config,
				assets,
				documentRenderer,
				browserPool: {
					get: async () => ({ newPage: async () => page }) as never,
					dispose: async () => {},
				},
			}).render(doc);
			assertInert(setContent.mock.calls[0]?.[0] ?? "", "pdf");

			const exported = await createBundleExportService({
				documents,
				documentRenderer,
				collections: createCollections({ bus, documents, store }),
				store,
				config,
				stateRenderSlots,
			}).build({ names: [doc.name], includeAssets: false });
			if (!exported.ok) throw new Error(exported.message);
			const bundle = await decodeBundle(exported.buffer);
			assertInert(
				bundle.documentStates[0]?.renderedSlots?.["/probe"] ?? "",
				"bundle",
			);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
			store.close();
		}
	});
});
