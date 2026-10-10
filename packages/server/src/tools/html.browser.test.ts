import type { DocumentStateData } from "@maket/shared";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CHROMIUM_HEADLESS,
	shouldDisableSandbox,
} from "../lib/chromium-sandbox.js";
import { createAssetsService } from "../services/assets.js";
import { createBrowserPool } from "../services/browser-pool.js";
import { createBus } from "../services/bus.js";
import { createCollectionCursors } from "../services/collection-cursor.js";
import { createCollectionRenderer } from "../services/collection-renderer.js";
import { createCollections } from "../services/collections.js";
import { createDocumentRenderer } from "../services/document-renderer.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import { createLayoutService } from "../services/layout.js";
import { createStateRenderer } from "../services/state-renderer.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketHtmlTool } from "./html.js";

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

describe("maket_html check — Chromium measurement of state-backed pages", () => {
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

	async function checkStatePage(html: string, data: DocumentStateData) {
		const store = createSQLiteStore(":memory:");
		const bus = createBus();
		const documents = createDocuments({ store });
		const documentStates = createDocumentStates({ bus, documents, store });
		store.saveDoc(
			createDocument({
				name: "graph",
				canvas: {
					format: "custom",
					orientation: "portrait",
					w: 100,
					h: 100,
					bg: "#fff",
				},
				pages: [{ name: "P1", elements: [], html }],
			}),
		);
		documents.loadAll();
		documentStates.initialize("graph", ITEMS_SCHEMA, data);
		const browserPool = createBrowserPool(
			{},
			{
				launch: async () => {
					if (!browser) throw new Error("Chromium did not start");
					return browser;
				},
			},
		);
		const layout = createLayoutService(
			{ bus, documents, browserPool },
			{ getAssetBaseUrl: () => "http://localhost" },
		);
		const tool = createMaketHtmlTool({
			documents,
			store,
			layout,
			assets: createAssetsService({ assetsDir: "/nonexistent" }),
			documentRenderer: createDocumentRenderer({
				collectionRenderer: createCollectionRenderer({
					collections: createCollections({ bus, documents, store }),
				}),
				stateRenderer: createStateRenderer({ documentStates }),
				structuredWorkspaces: {
					renderCollection: () => {
						throw new Error("No Structured Workspace in this test");
					},
				},
			}),
			collectionCursors: createCollectionCursors({ bus, documents, store }),
		});
		try {
			const result = await tool.handler(
				{ action: "check", doc: "graph", page: 1 },
				{} as never,
			);
			const graph = documents.resolve("graph");
			if (!graph) throw new Error("Expected the graph document");
			return {
				report:
					result.content[0]?.type === "text" ? result.content[0].text : "",
				template: (await layout.check(graph, html, 0)).status,
			};
		} finally {
			store.close();
		}
	}

	it("reports the overflow of a list that only escapes the canvas once its state renders", async () => {
		const { report, template } = await checkStatePage(
			'<ul data-id="list" style="margin:0;padding:0;list-style:none">{{#state.items}}<li style="height:20mm">{{label}}</li>{{/state.items}}</ul>',
			{
				items: Array.from({ length: 8 }, (_, index) => ({
					label: `Decision ${index + 1}`,
				})),
			},
		);

		expect(report.split("\n")[0]).toBe(
			"Measured with document state revision 1.",
		);
		expect(template).toBe("ok");
		expect(report).toContain("⛔");
		expect(report).toContain("list");
	}, 30_000);

	it("reports no overflow for a block the raw template shows but the state omits", async () => {
		const { report, template } = await checkStatePage(
			'<div data-id="summary" style="height:20mm">Summary</div>{{#state.items}}<div data-id="detail" style="height:150mm">{{label}}</div>{{/state.items}}',
			{ items: [] },
		);

		expect(report.split("\n")[0]).toBe(
			"Measured with document state revision 1.",
		);
		expect(template).toBe("overflow");
		expect(report).toContain("✓");
		expect(report).not.toContain("⛔");
	}, 30_000);
});
