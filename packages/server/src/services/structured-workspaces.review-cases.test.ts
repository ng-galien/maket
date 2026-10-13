import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMaketStructuredWorkspaceTool } from "../tools/structured-workspaces.js";
import type { Document } from "../types.js";
import { createBus } from "./bus.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { isItemSourceError } from "./item-sources/item-source-error.js";
import { createItemSources } from "./item-sources/item-sources.js";
import { createItemWindows, type ItemWindows } from "./item-windows.js";
import type { PageFlow, PageFlowRequest } from "./page-flow.js";
import { createSQLiteStore } from "./store.js";
import {
	createStructuredWorkspaces,
	type StructuredWorkspaces,
	type StructuredWorkspacesDeps,
} from "./structured-workspaces.js";

const snapshots = "./__snapshots__/structured-workspaces.review-cases";

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

const itemWindowsOf = new WeakMap<StructuredWorkspaces, ItemWindows>();

function engine(
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

/** The collection windows of an engine built by engine. */
function windowsOf(workspaces: StructuredWorkspaces): ItemWindows {
	const windows = itemWindowsOf.get(workspaces);
	if (!windows) throw new Error("engine built without item windows");
	return windows;
}

function scenario() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, bus, documents });
	const workspaces = engine({
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
	return { store, bus, documents, documentStates, workspaces, tool };
}

type Scenario = ReturnType<typeof scenario>;

const masked = (text: string) =>
	text.replace(/"(createdAt|updatedAt)": ?"[^"]*"/g, '"$1":"<now>"');

const textOf = (result: CallToolResult) =>
	result.content
		.flatMap((item) => (item.type === "text" ? [item.text] : []))
		.join("\n");

const pagesOf = (document: Document) =>
	JSON.stringify(
		document.pages.map((page) => ({
			id: page.id,
			name: page.name,
			html: page.html,
		})),
	);

async function call(current: Scenario, args: Record<string, unknown>) {
	try {
		const result = await current.tool.handler(args as never, {} as never);
		return `${result.isError ? "ERR " : ""}${masked(textOf(result))}`;
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

function safe(run: () => string): string {
	try {
		return run();
	} catch (error) {
		return `THROW ${(error as Error).message}`;
	}
}

async function capture(
	current: Scenario,
	workspaceId: string,
	collections: string[],
	extra: string[] = [],
) {
	const out: Record<string, string> = {};
	for (const collectionId of collections) {
		out[`index:${collectionId}`] = safe(() =>
			pagesOf(current.workspaces.renderCollection(workspaceId, collectionId)),
		);
		out[`index-cached:${collectionId}`] = safe(() =>
			pagesOf(current.workspaces.renderCollection(workspaceId, collectionId)),
		);
	}
	out.listViews = safe(() =>
		masked(JSON.stringify(current.workspaces.listViews())),
	);
	out.get = safe(() =>
		masked(JSON.stringify(current.workspaces.get(workspaceId))),
	);
	out.mcpView = await call(current, { action: "view", workspace: workspaceId });
	out.mcpCheck = await call(current, {
		action: "check",
		workspace: workspaceId,
	});
	for (const itemId of extra)
		out[`getItem:${itemId}`] = safe(() =>
			masked(JSON.stringify(current.workspaces.getItem(workspaceId, itemId))),
		);
	return out;
}

const schema = {
	type: "object",
	properties: {
		title: { type: "string" },
		status: { type: "string", enum: ["todo", "doing", "done"] },
		priority: { type: "number" },
		address: {
			type: "object",
			properties: { city: { type: "string" } },
			additionalProperties: false,
		},
		id: { type: "string" },
	},
	required: ["title", "status", "id"],
	additionalProperties: false,
};

/** Every collection identifies its items by the `id` property. */
const identity = "/id";

/** The default collection, as Maket generated it, with its identity. */
const itemsCollection = {
	version: 1 as const,
	collections: { items: { name: "Items", identity } },
};

async function add(
	current: Scenario,
	workspace: string,
	collectionId: string,
	count: number,
	data: (index: number) => Record<string, unknown> = (index) => ({
		title: `T${index}`,
		status: ["todo", "doing", "done"][index % 3],
		...(index % 4 ? { priority: index % 5 } : {}),
		address: { city: ["Lyon", "Brest"][index % 2] },
	}),
) {
	const added = [];
	for (let i = 0; i < count; i += 1)
		added.push(
			await current.workspaces.addItem({
				workspace,
				itemId: `${collectionId}-${i + 1}`,
				collectionId,
				bindingId: "item",
				documentName: `${workspace} ${collectionId} ${i + 1}`,
				data: { id: `${collectionId}-${i + 1}`, ...data(i + 1) },
			}),
		);
	return added;
}

interface Case {
	name: string;
	run: (current: Scenario) => Promise<Record<string, string>>;
}

const cases: Case[] = [
	{
		name: "empty-collection",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Empty",
				dataSchema: schema,
				representationSchema: itemsCollection,
			});
			return capture(current, ws.id, ["items"]);
		},
	},
	{
		name: "two-collections-grouped-sorted",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Two",
				dataSchema: schema,
				representationSchema: {
					version: 1,
					collections: {
						open: { name: "Open", identity },
						board: {
							name: "Board",
							identity,
							groupBy: "/address/city",
							sortBy: "/priority",
							sortDirection: "descending",
						},
					},
				},
			});
			await add(current, ws.name, "open", 5);
			await add(current, ws.name, "board", 7);
			return capture(current, ws.id, ["open", "board"], ["open-2", "board-3"]);
		},
	},
	{
		name: "stored-data-missing-required-field",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Broken",
				dataSchema: schema,
				representationSchema: itemsCollection,
			});
			const [first] = await add(current, ws.name, "items", 3);
			current.store.putStructuredWorkspaceItem(ws.id, first?.id ?? "", 1, {
				id: first?.id,
				status: "todo",
			});
			return {
				current: JSON.stringify(
					current.store.loadStructuredWorkspaceItem(ws.id, first?.id ?? "")
						?.data,
				),
				...(await capture(current, ws.id, ["items"], ["items-1", "items-2"])),
			};
		},
	},
	{
		name: "deleted-item",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Deleted",
				dataSchema: schema,
				representationSchema: itemsCollection,
			});
			await add(current, ws.name, "items", 4);
			await current.workspaces.deleteItem(ws.name, "items-2");
			return capture(current, ws.id, ["items"], ["items-2", "items-3"]);
		},
	},
	{
		name: "item-document-gone-from-registry",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Orphan",
				dataSchema: schema,
				representationSchema: itemsCollection,
			});
			const [first] = await add(current, ws.name, "items", 3);
			current.workspaces.openItem(ws.id, first?.documentName ?? "");
			current.documents.all().delete(first?.documentName ?? "");
			return capture(current, ws.id, ["items"], ["items-1", "items-2"]);
		},
	},
	{
		name: "update-item-wrong-revision",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Stale",
				dataSchema: schema,
				representationSchema: itemsCollection,
			});
			await add(current, ws.name, "items", 3);
			const refused = await call(current, {
				action: "update_item",
				workspace: ws.name,
				item: "items-2",
				expected_revision: 7,
				data: { id: "items-2", title: "New", status: "done" },
			});
			const accepted = await call(current, {
				action: "update_item",
				workspace: ws.name,
				item: "items-3",
				expected_revision: 1,
				data: { id: "items-3", title: "New", status: "done" },
			});
			return {
				refused,
				accepted,
				...(await capture(current, ws.id, ["items"], ["items-3"])),
			};
		},
	},
	{
		name: "locked-item-document",
		async run(current) {
			const ws = current.workspaces.create({
				name: "Locked",
				dataSchema: schema,
				representationSchema: itemsCollection,
			});
			const [first] = await add(current, ws.name, "items", 3);
			const document = current.workspaces.openItem(
				ws.id,
				first?.documentName ?? "",
			);
			if (document) document.meta.locked = true;
			const refused = await call(current, {
				action: "update_item",
				workspace: ws.name,
				item: "items-1",
				expected_revision: 1,
				data: { id: "items-1", title: "New", status: "done" },
			});
			const deleteRefused = await call(current, {
				action: "delete_item",
				workspace: ws.name,
				item: "items-1",
			});
			return {
				refused,
				deleteRefused,
				...(await capture(current, ws.id, ["items"], ["items-1"])),
			};
		},
	},
	{
		name: "card-nested-section-additional-property",
		async run(current) {
			const created = await call(current, {
				action: "create",
				workspace: "Nested",
				data_schema: {
					...schema,
					properties: { ...schema.properties, notes: { type: "string" } },
					additionalProperties: true,
				},
				representation_schema: {
					version: 1,
					collections: {
						items: {
							name: "Items",
							identity,
							compactTemplateHtml:
								'<article data-maket-compact-root data-id="c"><h3 data-id="t">{{ state.title }}</h3>{{#state.address}}<p data-id="a">{{ state.address.city }}</p>{{/state.address}}<i data-id="n">{{ state.notes }}</i></article>',
							detailTemplateHtml: '<h1 data-id="t">{{ state.title }}</h1>',
						},
					},
				},
			});
			const ws = current.workspaces.get("Nested");
			if (!ws) return { created };
			await add(current, ws.name, "items", 3, (index) => ({
				title: `T${index}`,
				status: "todo",
				notes: `n${index}`,
				hidden: `h${index}`,
				...(index === 2 ? {} : { address: { city: "Lyon" } }),
			}));
			return { created, ...(await capture(current, ws.id, ["items"])) };
		},
	},
];

let sequence = 0;

beforeEach(() => {
	sequence = 0;
	vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
		sequence += 1;
		return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function outputOf(run: Case["run"]): Promise<Record<string, string>> {
	const current = scenario();
	try {
		return await run(current);
	} catch (error) {
		return { setup: `THROW ${(error as Error).message}` };
	} finally {
		current.store.close();
	}
}

interface HeadItem {
	id: string;
	collectionId: string;
	documentName: string;
	data: Record<string, unknown>;
	dataRevision: number;
}

type HeadView = Record<string, unknown> & { items: HeadItem[] };

/** A HEAD definition with the identity the cases declare: the `id`
 * property required by the data schema, `identity` on every collection. */
function withIdentity(definition: Record<string, unknown>) {
	const schema = structuredClone(definition.dataSchema) as {
		properties: Record<string, unknown>;
		required: string[];
	};
	schema.properties.id = { type: "string" };
	schema.required.push("id");
	const representation = structuredClone(definition.representationSchema) as {
		collections: Record<string, Record<string, unknown>>;
	};
	for (const collection of Object.values(representation.collections))
		collection.identity = identity;
	return {
		...definition,
		dataSchema: schema,
		representationSchema: representation,
	};
}

/** The HEAD view under the new contract: no item data, the item count of
 * each collection and no pinned item instead, and the declared identity. */
function lightView(head: HeadView) {
	const { items, ...definition } = head;
	const collections = Object.keys(
		(definition.representationSchema as { collections: object }).collections,
	);
	return {
		...withIdentity(definition),
		itemCounts: Object.fromEntries(
			collections.map((id) => [
				id,
				items.filter((item) => item.collectionId === id).length,
			]),
		),
		pinnedItems: [],
	};
}

const isJson = (text: string) => text.startsWith("{") || text.startsWith("[");

/** The keys whose contract changed: listViews and get carry item counts
 * instead of items, the MCP view one window batch of the first collection. */
const changedKeys = new Set(["listViews", "get", "mcpView"]);

function expectNewViewContract(
	key: string,
	output: string,
	head: string,
): void {
	if (/^(THROW|ERR) Invalid state\/items\//.test(head)) {
		interface ChangedView {
			itemCounts: Record<string, number>;
			window?: {
				items: Array<{ id: string; issues?: Array<{ rule: string }> }>;
			};
		}
		const parsed = JSON.parse(output) as ChangedView | ChangedView[];
		const listed: ChangedView | undefined = Array.isArray(parsed)
			? parsed[0]
			: parsed;
		if (!listed) throw new Error(`${key}: no view`);
		expect(listed, key).not.toHaveProperty("items");
		expect(listed.itemCounts, key).toEqual({ items: 3 });
		if (key === "mcpView")
			expect(
				listed.window?.items.find((item) => item.id === "items-1")?.issues,
				key,
			).toEqual([expect.objectContaining({ rule: "required" })]);
		return;
	}
	if (!isJson(head)) {
		expect(output, key).toBe(head);
		return;
	}
	if (key === "listViews") {
		expect(JSON.parse(output), key).toEqual(
			(JSON.parse(head) as HeadView[]).map(lightView),
		);
		return;
	}
	if (key === "get") {
		expect(JSON.parse(output), key).toEqual(lightView(JSON.parse(head)));
		return;
	}
	const headView = JSON.parse(head) as HeadView;
	const { window, ...view } = JSON.parse(output) as {
		window: {
			collection: string;
			items: Array<{ id: string; revision: number; fields: object }>;
			total: number;
			next?: string;
		};
	};
	expect(view, key).toEqual(lightView(headView));
	const headItems = headView.items.filter(
		(item) => item.collectionId === window.collection,
	);
	expect(window.total, key).toBe(headItems.length);
	expect(window.next, key).toBeUndefined();
	expect(new Set(window.items.map((item) => item.id)), key).toEqual(
		new Set(headItems.map((item) => item.id)),
	);
	for (const item of window.items) {
		const headItem = headItems.find((candidate) => candidate.id === item.id);
		expect(item.revision, key).toBe(headItem?.dataRevision);
		const { id, ...fields } = item.fields as Record<string, unknown>;
		expect(id, key).toBe(item.id);
		expect(headItem?.data, key).toMatchObject(fields);
	}
}

/** An item view against its HEAD capture: the data holds the item id under
 * the identity, and the insertion sequence (1 for the first item added to
 * its collection, never reused) replaces the HEAD position. */
function expectItemView(key: string, output: string, head: string): void {
	if (output === "null" || head === "null") {
		expect(output, key).toBe(head);
		return;
	}
	const { sequence, data, ...rest } = JSON.parse(output);
	const { position: _position, data: headData, ...headRest } = JSON.parse(head);
	const { id, ...headless } = data;
	expect(rest, key).toEqual(headRest);
	expect(headless, key).toEqual(headData);
	expect(id, key).toBe(rest.id);
	expect(sequence, key).toBe(Number(String(rest.id).split("-").at(-1)));
}

describe("Structured Workspaces on the review cases: HEAD index and answers, views under the window contract", () => {
	it.each(cases)("$name", async ({ name, run }) => {
		const output = await outputOf(run);
		const head = JSON.parse(
			readFileSync(
				new URL(`${snapshots}/${name}.snap`, import.meta.url),
				"utf8",
			),
		) as Record<string, string>;
		expect(Object.keys(output).sort()).toEqual(Object.keys(head).sort());
		for (const [key, value] of Object.entries(output)) {
			if (changedKeys.has(key))
				expectNewViewContract(key, value, head[key] ?? "");
			else if (key.startsWith("getItem:"))
				expectItemView(key, value, head[key] ?? "null");
			else if (key === "current") {
				const { id, ...data } = JSON.parse(value);
				expect(id, key).toBe("items-1");
				expect(data, key).toEqual(JSON.parse(head[key] ?? "{}"));
			} else expect(value, key).toBe(head[key]);
		}
	});
});

describe("the local item source writes rows at a revision", () => {
	it("answers stale, unknown and duplicate refusals with their code, the engine answers lock and invalid data, and closes on deletion", async () => {
		const current = scenario();
		const sources = createItemSources(current);
		const ws = current.workspaces.create({
			name: "Src",
			dataSchema: schema,
			representationSchema: itemsCollection,
		});
		await add(current, ws.name, "items", 2);
		const source = sources.sourceFor(ws.id);
		const codeOf = async (run: () => Promise<unknown>) => {
			try {
				await run();
				return "ok";
			} catch (error) {
				return isItemSourceError(error) ? error.code : (error as Error).message;
			}
		};
		const document = current.workspaces.openItem(ws.id, `${ws.name} items 1`);
		if (document) document.meta.locked = true;
		const lockedUpdate = await codeOf(async () =>
			current.workspaces.updateItem(ws.name, "items-1", 1, {
				id: "items-1",
				title: "x",
				status: "todo",
			}),
		);
		const lockedDelete = await codeOf(async () =>
			current.workspaces.deleteItem(ws.name, "items-1"),
		);
		if (document) document.meta.locked = false;
		const results = {
			lockedUpdate,
			lockedDelete,
			invalidData: (
				await codeOf(async () =>
					current.workspaces.updateItem(ws.name, "items-2", 1, {
						id: "items-2",
						status: "todo",
					}),
				)
			).split("\n")[0],
			engineStale: await codeOf(async () =>
				current.workspaces.updateItem(ws.name, "items-2", 9, {
					id: "items-2",
					title: "x",
					status: "todo",
				}),
			),
			stale: await codeOf(async () =>
				source.put?.("items-2", { title: "x", status: "todo" }, "9"),
			),
			unknownPut: await codeOf(async () =>
				source.put?.("nope", { title: "x", status: "todo" }, "1"),
			),
			unknownDelete: await codeOf(async () => source.delete?.("nope")),
			duplicateCreate: await codeOf(async () =>
				source.create?.({
					collectionId: "items",
					bindingId: "item",
					id: "items-2",
					data: { title: "x", status: "todo" },
					document: { id: "d", name: "d" },
				}),
			),
			withoutDocument: await codeOf(async () =>
				source.create?.({
					collectionId: "items",
					bindingId: "item",
					id: "items-3",
					data: { title: "x", status: "todo" },
				}),
			),
			staleDelete: await codeOf(async () => source.delete?.("items-2", "5")),
			written: await codeOf(async () =>
				source.put?.("items-2", { title: "y", status: "done" }, "1"),
			),
		};
		const row = current.store.loadStructuredWorkspaceItem(ws.id, "items-2");
		current.workspaces.delete(ws.name);
		const afterDelete = await codeOf(async () =>
			source.list({ collectionId: "items", limit: 10 }),
		);
		const reopened = sources.sourceFor(ws.id) !== source;
		current.store.close();
		expect(results).toEqual({
			lockedUpdate:
				'Document "Src items 1" is locked. Unlock it before changing its Workspace.',
			lockedDelete:
				'Document "Src items 1" is locked. Unlock it before changing its Workspace.',
			invalidData: "Item data breaks the schema (1 issue(s)):",
			engineStale: "stale_revision",
			stale: "stale_revision",
			unknownPut: "unknown_item",
			unknownDelete: "unknown_item",
			duplicateCreate: "invalid_record",
			withoutDocument: "invalid_record",
			staleDelete: "stale_revision",
			written: "ok",
		});
		expect(row).toMatchObject({
			revision: 2,
			data: { title: "y", status: "done" },
		});
		expect(afterDelete).toBe("source_unreachable");
		expect(reopened).toBe(true);
	});
});
