import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMaketStructuredWorkspaceTool } from "../tools/structured-workspaces.js";
import { createBus } from "./bus.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createItemSources } from "./item-sources/item-sources.js";
import { createItemWindows, type ItemWindows } from "./item-windows.js";
import type { PageFlow, PageFlowRequest } from "./page-flow.js";
import { createSQLiteStore } from "./store.js";
import {
	createStructuredWorkspaces,
	type StructuredWorkspaces,
	type StructuredWorkspacesDeps,
} from "./structured-workspaces.js";

const snapshots = "./__snapshots__/structured-workspaces.no-change";

const dataSchema = {
	type: "object",
	properties: {
		title: { type: "string" },
		status: { type: "string", enum: ["todo", "doing", "done"] },
		priority: { type: "number" },
		tags: { type: "array", items: { type: "string" } },
		address: {
			type: "object",
			properties: { city: { type: "string" }, zip: { type: "string" } },
			additionalProperties: false,
		},
	},
	required: ["title", "status"],
	additionalProperties: false,
};

const cities = ["Lyon", "Paris", "Nantes", "Brest"];
const statuses = ["todo", "doing", "done"];

function itemData(index: number): Record<string, unknown> {
	return {
		title: `Item ${String(index).padStart(2, "0")}`,
		status: statuses[index % 3],
		...(index % 5 === 0 ? {} : { priority: (index * 7) % 10 }),
		tags: [`t${index % 4}`, `u${index % 2}`],
		address: { city: cities[index % 4], zip: `${69000 + index}` },
	};
}

const flowedPageCards = 4;

function flowCount(request: PageFlowRequest, list: string): number {
	return request.full.html.split(`<!--maket-flow:${list}:`).length - 1;
}

const pageFlow: Pick<PageFlow, "pages"> = {
	pages(request) {
		const counts = request.full.lists.map((list) => flowCount(request, list));
		const chunks = Math.max(
			1,
			...counts.map((count) => Math.ceil(count / flowedPageCards)),
		);
		if (chunks <= 1) return null;
		return Array.from({ length: chunks }, (_, page) =>
			Object.fromEntries(
				request.full.lists.map((list, index) => {
					const count = counts[index] ?? 0;
					const start = Math.min(page * flowedPageCards, count);
					const end =
						page === chunks - 1
							? null
							: Math.min(start + flowedPageCards, count);
					return [list, [start, end]];
				}),
			),
		);
	},
};

function scenario() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, bus, documents });
	const workspaces = structuredWorkspacesWithSources({
		store,
		bus,
		documents,
		documentStates,
		pageFlow,
	});
	const tool = createMaketStructuredWorkspaceTool({
		structuredWorkspaces: workspaces,
		itemWindows: windowsOf(workspaces),
	});
	return { store, documents, workspaces, tool };
}

type Scenario = ReturnType<typeof scenario>;

async function fill(
	workspaces: Scenario["workspaces"],
	workspace: string,
	collectionId: string,
): Promise<void> {
	for (let index = 1; index <= 20; index += 1) {
		await workspaces.addItem({
			workspace,
			itemId: `${collectionId}-${index}`,
			collectionId,
			bindingId: "item",
			documentName: `${workspace} item ${index}`,
			data: itemData(index),
		});
	}
}

async function buildUngrouped(
	workspaces: Scenario["workspaces"],
): Promise<string> {
	const workspace = workspaces.create({ name: "Ungrouped", dataSchema });
	await fill(workspaces, workspace.name, "items");
	return workspace.id;
}

async function buildGroupedSorted(
	workspaces: Scenario["workspaces"],
): Promise<string> {
	const workspace = workspaces.create({
		name: "Grouped",
		dataSchema,
		representationSchema: {
			version: 1,
			collections: {
				items: {
					name: "Items",
					groupBy: "/status",
					groupOrder: ["doing", "todo"],
					sortBy: "/priority",
					sortDirection: "descending",
				},
			},
		},
	});
	await fill(workspaces, workspace.name, "items");
	return workspace.id;
}

async function buildPagedA4(
	workspaces: Scenario["workspaces"],
): Promise<string> {
	const workspace = workspaces.create({
		name: "Paged",
		dataSchema,
		representationSchema: {
			version: 1,
			collections: {
				board: {
					name: "Board",
					groupBy: "/status",
					sortBy: "/title",
					pageSize: 6,
					indexTemplateHtml:
						'<main data-id="board"><h1 data-id="heading">Board</h1><section data-id="all" data-maket-structured-items></section><section data-id="todo" data-maket-structured-items="item" data-maket-structured-filter="status=todo"></section></main>',
					compactTemplateHtml:
						'<style>.card h3{color:#1f3a5f}</style><article class="card" data-maket-compact-root data-id="card"><h3 data-id="title">{{ state.title }}</h3><p data-id="city">{{ state.address.city }}</p><span data-id="priority">{{ state.priority }}</span><a data-maket-action="open-document">Open</a></article>',
					detailTemplateHtml: '<h1 data-id="title">{{ state.title }}</h1>',
				},
			},
		},
	});
	await fill(workspaces, workspace.name, "board");
	return workspace.id;
}

const sqliteTimestamp = /"(createdAt|updatedAt)": ?"[^"]*"/g;

function withoutSqliteTimestamps(serialized: string): string {
	return serialized.replace(sqliteTimestamp, '"$1":"<sqlite-now>"');
}

function textOf(result: CallToolResult): string {
	return result.content
		.flatMap((item) => (item.type === "text" ? [item.text] : []))
		.join("\n");
}

async function captured(
	current: Scenario,
	target: { workspaceId: string; collectionId: string },
) {
	const first = current.workspaces.renderCollection(
		target.workspaceId,
		target.collectionId,
	);
	const cached = current.workspaces.renderCollection(
		target.workspaceId,
		target.collectionId,
	);
	const pages = (document: typeof first) =>
		JSON.stringify(
			document.pages.map((page) => ({
				id: page.id,
				name: page.name,
				html: page.html,
			})),
			null,
			2,
		);
	const view = await current.tool.handler(
		{ action: "view", workspace: target.workspaceId },
		{} as never,
	);
	return {
		index: pages(first),
		cachedIndex: pages(cached),
		listViews: JSON.parse(
			withoutSqliteTimestamps(JSON.stringify(current.workspaces.listViews())),
		) as Array<Record<string, unknown>>,
		mcpView: JSON.parse(withoutSqliteTimestamps(textOf(view))) as Record<
			string,
			unknown
		>,
	};
}

interface HeadItem {
	id: string;
	collectionId: string;
	documentName: string;
	data: Record<string, unknown>;
	dataRevision: number;
}

type HeadView = Record<string, unknown> & { items: HeadItem[] };

/** A view captured at HEAD (increment b1), every item with its data. */
function headCapture(file: string): unknown {
	return JSON.parse(
		readFileSync(new URL(`${snapshots}/${file}`, import.meta.url), "utf8"),
	);
}

/** The HEAD view under the new contract: no item data, the item count of
 * each collection and no pinned item instead. */
function lightView(head: HeadView) {
	const { items, ...definition } = head;
	const collections = Object.keys(
		(definition.representationSchema as { collections: object }).collections,
	);
	return {
		...definition,
		itemCounts: Object.fromEntries(
			collections.map((id) => [
				id,
				items.filter((item) => item.collectionId === id).length,
			]),
		),
		pinnedItems: [],
	};
}

interface ViewWindow {
	collection: string;
	query: Record<string, unknown>;
	items: Array<{
		id: string;
		documentName: string;
		revision: number;
		fields: Record<string, unknown>;
	}>;
	total: number;
	groups?: unknown;
	next?: string;
}

describe("Structured Workspaces composition from the collection window", () => {
	let sequence = 0;
	let current: Scenario;

	beforeEach(() => {
		sequence = 0;
		vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
			sequence += 1;
			return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
		});
		current = scenario();
	});

	afterEach(() => {
		current.store.close();
		vi.restoreAllMocks();
	});

	it.each([
		{
			name: "ungrouped",
			build: buildUngrouped,
			collectionId: "items",
			groups: undefined,
		},
		{
			name: "grouped-sorted",
			build: buildGroupedSorted,
			collectionId: "items",
			groups: [
				{ value: "doing", count: 7 },
				{ value: "todo", count: 6 },
				{ value: "done", count: 7 },
			],
		},
		{
			name: "paged-a4",
			build: buildPagedA4,
			collectionId: "board",
			groups: [
				{ value: "doing", count: 7 },
				{ value: "done", count: 7 },
				{ value: "todo", count: 6 },
			],
		},
	])(
		"$name: the first batch of 20 items renders the HEAD index; views carry counts and one window batch instead of item data",
		async ({ name, build, collectionId, groups }) => {
			const workspaceId = await build(current.workspaces);
			const output = await captured(current, { workspaceId, collectionId });
			expect(output.cachedIndex).toBe(output.index);
			await expect(output.index).toMatchFileSnapshot(
				`${snapshots}/${name}.index.snap`,
			);

			const [headListed] = headCapture(`${name}.list-views.snap`) as HeadView[];
			if (!headListed) throw new Error("HEAD capture missing.");
			expect(output.listViews).toEqual([lightView(headListed)]);
			expect(output.listViews[0]).not.toHaveProperty("items");

			const head = headCapture(`${name}.mcp-view.snap`) as HeadView;
			const { window, ...view } = output.mcpView as {
				window: ViewWindow;
			};
			expect(view).toEqual(lightView(head));
			expect(window).toMatchObject({
				collection: collectionId,
				query: {},
				total: 20,
			});
			expect(window.next).toBeUndefined();
			expect(window.groups).toEqual(groups);
			expect(window.items).toHaveLength(20);
			const headItems = new Map(head.items.map((item) => [item.id, item]));
			for (const item of window.items) {
				const headItem = headItems.get(item.id);
				expect(item.documentName).toBe(headItem?.documentName);
				expect(item.revision).toBe(headItem?.dataRevision);
				for (const [key, value] of Object.entries(item.fields))
					expect(headItem?.data[key]).toEqual(value);
			}
			expect(new Set(window.items.map((item) => item.id))).toEqual(
				new Set(headItems.keys()),
			);
		},
	);
});

describe("Structured Workspaces read cost", () => {
	it("lists ten items without reading an item row and with at most the increment (a) HEAD resolveById count", async () => {
		const current = scenario();
		const workspace = current.workspaces.create({ name: "Cost", dataSchema });
		for (let index = 1; index <= 10; index += 1)
			await current.workspaces.addItem({
				workspace: workspace.name,
				itemId: `cost-${index}`,
				collectionId: "items",
				bindingId: "item",
				documentName: `Cost ${index}`,
				data: itemData(index),
			});
		const resolveById = vi.spyOn(current.documents, "resolveById");
		const itemRows = vi.spyOn(current.store, "loadStructuredWorkspaceItem");
		const batches = vi.spyOn(current.store, "loadStructuredWorkspaceItemBatch");
		current.workspaces.listViews();
		const counts = {
			resolveById: resolveById.mock.calls.length,
			itemRows: itemRows.mock.calls.length,
			batches: batches.mock.calls.length,
		};
		current.store.close();
		expect(counts.resolveById).toBeLessThanOrEqual(48);
		expect(counts).toEqual({ resolveById: 8, itemRows: 0, batches: 0 });
	});
});

const itemWindowsOf = new WeakMap<StructuredWorkspaces, ItemWindows>();

function structuredWorkspacesWithSources(
	deps: Omit<StructuredWorkspacesDeps, "itemSources" | "itemWindows">,
): StructuredWorkspaces {
	const itemSources = createItemSources(deps);
	const itemWindows = createItemWindows({ ...deps, itemSources });
	const workspaces = createStructuredWorkspaces({
		...deps,
		itemSources,
		itemWindows,
	});
	itemWindowsOf.set(workspaces, itemWindows);
	return workspaces;
}

/** The collection windows of an engine built by structuredWorkspacesWithSources. */
function windowsOf(workspaces: StructuredWorkspaces): ItemWindows {
	const windows = itemWindowsOf.get(workspaces);
	if (!windows) throw new Error("engine built without item windows");
	return windows;
}
