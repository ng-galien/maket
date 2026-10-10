import { parseHTML } from "linkedom";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import { createMaketHtmlTool } from "../tools/html.js";
import { createDocument } from "../types.js";
import { createAssetsService } from "./assets.js";
import { createBrowserPool } from "./browser-pool.js";
import { createBus } from "./bus.js";
import { createCollectionCursors } from "./collection-cursor.js";
import { createCollectionRenderer } from "./collection-renderer.js";
import { createCollections } from "./collections.js";
import { createDocumentRenderer } from "./document-renderer.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createLayoutService } from "./layout.js";
import { createPageFlow } from "./page-flow.js";
import { createStateRenderer } from "./state-renderer.js";
import { createSQLiteStore } from "./store.js";
import { createStructuredWorkspaces } from "./structured-workspaces.js";

const canvas = {
	format: "custom" as const,
	orientation: "portrait" as const,
	w: 100,
	h: 100,
	bg: "#fff",
};

const ITEMS_SCHEMA = {
	type: "object",
	properties: {
		items: {
			type: "array",
			items: {
				type: "object",
				properties: { label: { type: "string" } },
				required: ["label"],
			},
		},
	},
	required: ["items"],
} as const;

describe("page flow — lists longer than their page, laid out in Chromium", () => {
	let browser: Browser | undefined;

	beforeAll(async () => {
		browser = await puppeteer.launch({
			headless: CHROMIUM_HEADLESS,
			args: shouldDisableSandbox() ? ["--no-sandbox"] : [],
		});
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	function services() {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const documentStates = createDocumentStates({ bus, documents, store });
		const browserPool = createBrowserPool(
			{},
			{
				launch: async () => {
					if (!browser) throw new Error("Chromium did not start");
					return browser;
				},
			},
		);
		const pageFlow = createPageFlow(
			{ bus, browserPool, documents },
			{ getAssetBaseUrl: () => "http://localhost" },
		);
		const layout = createLayoutService(
			{ bus, documents, browserPool },
			{ getAssetBaseUrl: () => "http://localhost" },
		);
		const flowed: string[] = [];
		bus.on("document:flowed", ({ docName }) => flowed.push(docName));
		return {
			store,
			bus,
			documents,
			documentStates,
			pageFlow,
			layout,
			flowed,
		};
	}

	function listItems(html: string | undefined): string[] {
		const { document } = parseHTML(`<html><body>${html ?? ""}</body></html>`);
		return [...document.querySelectorAll("li")].map(
			(item) => item.textContent ?? "",
		);
	}

	it("continues a state list onto generated pages and the rendered check finds no overflow", async () => {
		const { store, bus, documents, documentStates, pageFlow, layout, flowed } =
			services();
		store.saveDoc(
			createDocument({
				name: "decisions",
				canvas,
				pages: [
					{
						name: "Decisions",
						elements: [],
						html: '<main data-id="page" style="width:100mm;height:100mm;overflow:hidden"><h1 data-id="title" style="height:10mm;font-size:5mm">Decisions</h1><ul data-id="list" style="list-style:none">{{#state.items}}<li style="height:20mm">{{label}}</li>{{/state.items}}</ul>{{^state.items}}<p data-id="none">None</p>{{/state.items}}</main>',
					},
					{
						name: "Back",
						elements: [],
						html: '<main data-id="page" style="width:100mm;height:100mm"><a data-id="first" href="#page=1">Decisions</a> <a data-id="self" href="#page=2">Back</a></main>',
					},
				],
			}),
		);
		documents.loadAll();
		documentStates.initialize("decisions", ITEMS_SCHEMA, {
			items: Array.from({ length: 12 }, (_, index) => ({
				label: `Decision ${index + 1}`,
			})),
		});
		const stateRenderer = createStateRenderer({ documentStates, pageFlow });
		const documentRenderer = createDocumentRenderer({
			collectionRenderer: createCollectionRenderer({
				collections: createCollections({ bus, documents, store }),
			}),
			stateRenderer,
			structuredWorkspaces: {
				renderCollection: () => {
					throw new Error("No Structured Workspace in this test");
				},
			},
			pageFlow,
		});
		const doc = documents.resolve("decisions");
		if (!doc) throw new Error("Expected the decisions document");
		try {
			expect(documentRenderer.render(doc).pages).toHaveLength(2);

			const rendered = await documentRenderer.renderSettled(doc);

			expect(flowed).toEqual(["decisions"]);
			expect(rendered.pages.map((page) => page.name)).toEqual([
				"Decisions",
				"Decisions (2)",
				"Decisions (3)",
				"Back",
			]);
			expect(
				rendered.pages.slice(0, 3).map((page) => listItems(page.html)),
			).toEqual([
				["Decision 1", "Decision 2", "Decision 3", "Decision 4"],
				["Decision 5", "Decision 6", "Decision 7", "Decision 8"],
				["Decision 9", "Decision 10", "Decision 11", "Decision 12"],
			]);
			for (const page of rendered.pages.slice(0, 3)) {
				expect(page.html).toContain(">Decisions</h1>");
				expect(page.html).not.toContain("None");
				expect(page.html).not.toContain("<!--maket-flow");
			}
			expect(rendered.pages[1]?.html).toContain(
				'data-maket-flow-page="2" data-maket-flow-pages="3"',
			);
			expect(rendered.pages[3]?.html).toContain('href="#page=1"');
			expect(rendered.pages[3]?.html).toContain('href="#page=4"');
			expect(stateRenderer.renderPages(doc, ["/items/0"])).toMatchObject({
				flowed: true,
				pages: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }],
			});

			const tool = createMaketHtmlTool({
				documents,
				store,
				layout,
				assets: createAssetsService({ assetsDir: "/nonexistent" }),
				documentRenderer,
				collectionCursors: createCollectionCursors({ bus, documents, store }),
			});
			const result = await tool.handler(
				{ action: "check", doc: "decisions", page: 1 },
				{} as never,
			);
			const report =
				result.content[0]?.type === "text" ? result.content[0].text : "";
			expect(report.split("\n")[0]).toBe(
				"Measured with document state revision 1. A list flows onto 3 pages.",
			);
			expect(report).toContain("Page 3 of 3 (Decisions (3)):");
			expect(report).toContain("✓");
			expect(report).not.toContain("⛔");
		} finally {
			store.close();
		}
	}, 60_000);

	it("continues the cards of a Structured Workspace items slot onto generated pages", async () => {
		const { store, bus, documents, documentStates, pageFlow, layout } =
			services();
		const detail = createDocument({
			name: "Project detail",
			canvas,
			pages: [
				{ name: "Detail", elements: [], html: "<h1>{{ state.title }}</h1>" },
			],
		});
		const compact = createDocument({
			name: "Project card",
			canvas,
			pages: [
				{
					name: "Card",
					elements: [],
					html: '<div data-id="card" data-maket-compact-root style="height:20mm">{{ state.title }}</div>',
				},
			],
		});
		const board = createDocument({
			name: "Project board",
			canvas,
			pages: [
				{
					name: "Index",
					elements: [],
					html: '<main data-id="page" style="width:100mm;height:100mm;overflow:hidden"><h1 data-id="heading" style="height:10mm;font-size:5mm">Projects</h1><section data-id="grid" data-maket-structured-items="project"></section></main>',
				},
			],
		});
		for (const document of [detail, compact, board]) {
			documents.all().set(document.name, document);
			documents.persist(document.name);
		}
		const workspaces = createStructuredWorkspaces({
			store,
			documents,
			documentStates,
			bus,
			pageFlow,
		});
		const workspace = workspaces.create({
			name: "Portfolio",
			dataSchema: {
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			representationSchema: {
				version: 1,
				collections: {
					projects: {
						name: "Projects",
						collectionTemplateDocumentId: board.name,
						bindings: {
							project: {
								schemaPath: "",
								compactTemplateDocumentId: compact.name,
								detailTemplateDocumentId: detail.name,
							},
						},
					},
				},
			},
		});
		for (let index = 0; index < 12; index += 1) {
			workspaces.addItem({
				workspace: "Portfolio",
				itemId: `project-${index}`,
				collectionId: "projects",
				bindingId: "project",
				documentName: `Project ${index + 1}`,
				data: { title: `Project ${index + 1}` },
			});
		}
		try {
			workspaces.renderCollection(workspace.id, "projects");
			await pageFlow.settle();
			const rendered = workspaces.renderCollection(workspace.id, "projects");

			expect(rendered.pages.map((page) => page.name)).toEqual([
				"Index",
				"Index (2)",
				"Index (3)",
			]);
			const cards = rendered.pages.map((page) => {
				const { document } = parseHTML(
					`<html><body>${page.html ?? ""}</body></html>`,
				);
				return [
					...document.querySelectorAll(
						"[data-maket-structured-items] > article",
					),
				].map((card) => card.getAttribute("data-maket-document"));
			});
			expect(cards.map((page) => page.length)).toEqual([4, 4, 4]);
			expect(new Set(cards.flat()).size).toBe(12);
			const collectionDocument = documents.resolve(rendered.name);
			if (!collectionDocument) throw new Error("Expected the index document");
			for (const page of rendered.pages) {
				expect(page.html).toContain(">Projects</h1>");
				const measured = await layout.check(
					collectionDocument,
					page.html ?? "",
					0,
				);
				expect(measured.status).toBe("ok");
			}
		} finally {
			store.close();
		}
	}, 60_000);

	it("puts an item taller than its page alone on its page and continues with the rest", async () => {
		const { store, bus, documents, documentStates, pageFlow } = services();
		store.saveDoc(
			createDocument({
				name: "tall",
				canvas,
				pages: [
					{
						name: "Tall",
						elements: [],
						html: '<main data-id="page" style="width:100mm;height:100mm;overflow:hidden"><h1 data-id="title" style="height:10mm;font-size:5mm">Tall</h1><ul data-id="list" style="list-style:none">{{#state.items}}<li style="height:{{h}}mm">{{label}}</li>{{/state.items}}</ul></main>',
					},
				],
			}),
		);
		documents.loadAll();
		const heights = [50, 150, 20, 20, 20, 20];
		documentStates.initialize(
			"tall",
			{
				type: "object",
				properties: {
					items: {
						type: "array",
						items: {
							type: "object",
							properties: { label: { type: "string" }, h: { type: "number" } },
							required: ["label", "h"],
						},
					},
				},
				required: ["items"],
			},
			{ items: heights.map((h, index) => ({ label: `Item ${index + 1}`, h })) },
		);
		const documentRenderer = createDocumentRenderer({
			collectionRenderer: createCollectionRenderer({
				collections: createCollections({ bus, documents, store }),
			}),
			stateRenderer: createStateRenderer({ documentStates, pageFlow }),
			structuredWorkspaces: {
				renderCollection: () => {
					throw new Error("No Structured Workspace in this test");
				},
			},
			pageFlow,
		});
		const doc = documents.resolve("tall");
		if (!doc) throw new Error("Expected the tall document");
		try {
			const rendered = await documentRenderer.renderSettled(doc);

			expect(rendered.pages.map((page) => listItems(page.html))).toEqual([
				["Item 1"],
				["Item 2"],
				["Item 3", "Item 4", "Item 5", "Item 6"],
			]);
			expect(rendered.pages.map((page) => page.flow)).toEqual([
				{ sourcePageId: doc.pages[0]?.id, index: 0, count: 3 },
				{ sourcePageId: doc.pages[0]?.id, index: 1, count: 3 },
				{ sourcePageId: doc.pages[0]?.id, index: 2, count: 3 },
			]);
		} finally {
			store.close();
		}
	}, 60_000);

	it("puts a Workspace card taller than its page alone on its page", async () => {
		const { store, bus, documents, documentStates, pageFlow } = services();
		const detail = createDocument({
			name: "Card detail",
			canvas,
			pages: [
				{ name: "Detail", elements: [], html: "<h1>{{ state.title }}</h1>" },
			],
		});
		const compact = createDocument({
			name: "Tall card",
			canvas,
			pages: [
				{
					name: "Card",
					elements: [],
					html: '<div data-id="card" data-maket-compact-root style="height:{{ state.h }}mm">{{ state.title }}</div>',
				},
			],
		});
		const board = createDocument({
			name: "Tall board",
			canvas,
			pages: [
				{
					name: "Index",
					elements: [],
					html: '<main data-id="page" style="width:100mm;height:100mm;overflow:hidden"><h1 data-id="heading" style="height:10mm;font-size:5mm">Cards</h1><section data-id="grid" data-maket-structured-items="card"></section></main>',
				},
			],
		});
		for (const document of [detail, compact, board]) {
			documents.all().set(document.name, document);
			documents.persist(document.name);
		}
		const workspaces = createStructuredWorkspaces({
			store,
			documents,
			documentStates,
			bus,
			pageFlow,
		});
		const workspace = workspaces.create({
			name: "Tall cards",
			dataSchema: {
				type: "object",
				properties: { title: { type: "string" }, h: { type: "number" } },
				required: ["title", "h"],
			},
			representationSchema: {
				version: 1,
				collections: {
					cards: {
						name: "Cards",
						collectionTemplateDocumentId: board.name,
						bindings: {
							card: {
								schemaPath: "",
								compactTemplateDocumentId: compact.name,
								detailTemplateDocumentId: detail.name,
							},
						},
					},
				},
			},
		});
		for (const [index, h] of [50, 150, 20, 20].entries()) {
			workspaces.addItem({
				workspace: "Tall cards",
				itemId: `card-${index}`,
				collectionId: "cards",
				bindingId: "card",
				documentName: `Card ${index + 1}`,
				data: { title: `Card ${index + 1}`, h },
			});
		}
		try {
			workspaces.renderCollection(workspace.id, "cards");
			await pageFlow.settle();
			const rendered = workspaces.renderCollection(workspace.id, "cards");

			expect(
				rendered.pages.map((page) => {
					const { document } = parseHTML(
						`<html><body>${page.html ?? ""}</body></html>`,
					);
					return [
						...document.querySelectorAll(
							"[data-maket-structured-items] > article",
						),
					].map((card) => card.getAttribute("data-maket-document"));
				}),
			).toEqual([["Card 1"], ["Card 2"], ["Card 3", "Card 4"]]);
		} finally {
			store.close();
		}
	}, 60_000);
});
