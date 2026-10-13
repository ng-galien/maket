import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBus } from "../bus.js";
import { createDocumentStates } from "../document-states.js";
import { createDocuments } from "../documents.js";
import { createItemWindows } from "../item-windows.js";
import { createSQLiteStore } from "../store.js";
import {
	createStructuredWorkspaces,
	type StructuredWorkspaces,
} from "../structured-workspaces.js";
import type { ItemSource } from "./item-source.js";
import { isItemSourceError } from "./item-source-error.js";
import { createItemSources, type ItemSources } from "./item-sources.js";

const dataSchema = {
	type: "object",
	properties: {
		title: { type: "string" },
		status: { type: "string" },
		priority: { type: "number" },
		address: {
			type: "object",
			properties: { city: { type: "string" } },
		},
		id: { type: "string" },
	},
	required: ["title", "status", "id"],
	additionalProperties: false,
};

const rows = [
	{ title: "Alpha", status: "todo", priority: 2 },
	{ title: "Bravo", status: "done", priority: 9 },
	{ title: "Charlie", status: "todo", priority: 5 },
	{ title: "Delta", status: "doing" },
	{ title: "Echo", status: "done", priority: 1 },
];

async function setup() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, bus, documents });
	const deps = { store, bus, documents, documentStates };
	const itemSources: ItemSources = createItemSources(deps);
	const workspaces: StructuredWorkspaces = createStructuredWorkspaces({
		...deps,
		itemSources,
		itemWindows: createItemWindows({ bus, store, itemSources }),
	});
	const workspace = workspaces.create({
		name: "Tracker",
		dataSchema,
		representationSchema: {
			version: 1,
			collections: {
				items: {
					name: "Items",
					identity: "/id",
					groupBy: "/status",
					groupOrder: ["doing"],
				},
			},
		},
	});
	for (const [index, row] of rows.entries()) {
		await workspaces.addItem({
			workspace: workspace.id,
			itemId: `item-${index + 1}`,
			collectionId: "items",
			bindingId: "item",
			documentName: `Tracker ${row.title}`,
			data: { id: `item-${index + 1}`, ...row, address: { city: "Lyon" } },
		});
	}
	return {
		store,
		bus,
		documents,
		workspaces,
		itemSources,
		workspace,
		source: itemSources.sourceFor(workspace.id),
	};
}

function codeOf(run: () => unknown): string | undefined {
	try {
		run();
	} catch (error) {
		return isItemSourceError(error) ? error.code : "not an item source error";
	}
	return undefined;
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
	const error = await promise.then(
		() => null,
		(failure: unknown) => failure,
	);
	return isItemSourceError(error) ? error.code : String(error);
}

describe("createLocalItemSource", () => {
	let current: Awaited<ReturnType<typeof setup>>;
	let source: ItemSource;

	beforeEach(async () => {
		current = await setup();
		source = current.source;
	});

	afterEach(() => {
		current.store.close();
	});

	it("declares what Maket's own storage supports", () => {
		expect(source.capabilities()).toEqual({
			readOnly: false,
			create: true,
			delete: true,
			search: true,
			sort: "pushdown",
			total: "exact",
			changes: "poll",
			revisions: "local",
		});
	});

	it("lists a whole short collection in position order, with an exact total and no next cursor", () => {
		const page = source.list({ collectionId: "items", limit: 10 });
		expect(page.items.map((item) => item.id)).toEqual([
			"item-1",
			"item-2",
			"item-3",
			"item-4",
			"item-5",
		]);
		expect(page.total).toBe(5);
		expect(page.next).toBeUndefined();
		expect(page.groups).toBeUndefined();
		expect(page.items[0]).toMatchObject({
			revision: "1",
			bindingId: "item",
		});
	});

	it("keeps in summaries only the fields the index reads", () => {
		const [first] = source.list({ collectionId: "items", limit: 1 }).items;
		expect(first?.fields).toEqual({
			id: "item-1",
			title: "Alpha",
			status: "todo",
			priority: 2,
		});
		expect(source.get("item-1")?.data).toEqual({
			id: "item-1",
			title: "Alpha",
			status: "todo",
			priority: 2,
			address: { city: "Lyon" },
		});
	});

	it("orders like the index: groupOrder first, groups by first appearance, sort inside, missing values last", () => {
		const page = source.list({
			collectionId: "items",
			groupBy: "/status",
			sort: { field: "/priority", direction: "descending" },
			limit: 10,
		});
		expect(page.items.map((item) => item.fields.title)).toEqual([
			"Delta",
			"Charlie",
			"Alpha",
			"Bravo",
			"Echo",
		]);
		expect(page.groups).toEqual([
			{ value: "doing", count: 1 },
			{ value: "todo", count: 2 },
			{ value: "done", count: 2 },
		]);
	});

	it("sorts in both directions, items without a value last in both, text by case and number value", () => {
		const titles = (direction: "ascending" | "descending", field: string) =>
			source
				.list({ collectionId: "items", sort: { field, direction }, limit: 10 })
				.items.map((item) => item.fields.title);
		expect(titles("ascending", "/priority")).toEqual([
			"Echo",
			"Alpha",
			"Charlie",
			"Bravo",
			"Delta",
		]);
		expect(titles("descending", "/priority")).toEqual([
			"Bravo",
			"Charlie",
			"Alpha",
			"Echo",
			"Delta",
		]);
		current.store.putStructuredWorkspaceItem(
			current.workspace.id,
			"item-1",
			1,
			{
				title: "item 10",
				status: "todo",
			},
		);
		current.store.putStructuredWorkspaceItem(
			current.workspace.id,
			"item-2",
			1,
			{
				title: "Item 9",
				status: "todo",
			},
		);
		expect(titles("ascending", "/title")).toEqual([
			"Charlie",
			"Delta",
			"Echo",
			"Item 9",
			"item 10",
		]);
		expect(titles("descending", "/title")).toEqual([
			"item 10",
			"Item 9",
			"Echo",
			"Delta",
			"Charlie",
		]);
	});

	it("searches the text properties of the binding schema, ignoring case, and counts the matches", () => {
		const page = source.list({ collectionId: "items", text: "HAR", limit: 10 });
		expect(page.items.map((item) => item.fields.title)).toEqual(["Charlie"]);
		expect(page.total).toBe(1);
		expect(
			source
				.list({ collectionId: "items", text: "ha", limit: 10 })
				.items.map((item) => item.fields.title),
		).toEqual(["Alpha", "Charlie"]);
		expect(
			source.list({ collectionId: "items", text: "DOING", limit: 10 }).total,
		).toBe(1);
		expect(
			source.list({ collectionId: "items", text: "100%", limit: 10 }).items,
		).toEqual([]);
		expect(
			source.list({ collectionId: "items", text: "Lyon", limit: 10 }).total,
		).toBe(0);
	});

	it("searches the declared searchFields only", async () => {
		const workspace = current.workspaces.get(current.workspace.id);
		if (!workspace) throw new Error("workspace");
		current.workspaces.updateDefinition({
			workspace: workspace.id,
			expectedRevision: workspace.revision,
			representationSchema: {
				version: 1,
				collections: {
					items: {
						name: "Items",
						groupBy: "/status",
						groupOrder: ["doing"],
						searchFields: ["/address/city"],
					},
				},
			},
		});
		expect(
			source.list({ collectionId: "items", text: "lyo", limit: 10 }).total,
		).toBe(5);
		expect(
			source.list({ collectionId: "items", text: "Alpha", limit: 10 }).total,
		).toBe(0);
	});

	it("filters with eq and in on the value type, and groups the whole query", () => {
		const eq = source.list({
			collectionId: "items",
			filters: [{ field: "/status", op: "eq", value: "todo" }],
			limit: 10,
		});
		expect(eq.items.map((item) => item.id)).toEqual(["item-1", "item-3"]);
		expect(eq.total).toBe(2);
		const within = source.list({
			collectionId: "items",
			filters: [
				{ field: "/status", op: "in", value: ["todo", "doing"] },
				{ field: "/priority", op: "in", value: [2, 5, "9"] },
			],
			groupBy: "/status",
			limit: 1,
		});
		expect(within.items.map((item) => item.id)).toEqual(["item-1"]);
		expect(within.groups).toEqual([{ value: "todo", count: 2 }]);
		expect(within.total).toBe(2);
		expect(
			source
				.list({
					collectionId: "items",
					filters: [{ field: "/priority", op: "eq", value: null }],
					limit: 10,
				})
				.items.map((item) => item.id),
		).toEqual(["item-4"]);
	});

	it("continues a query by an opaque keyset cursor across inserts and deletes", async () => {
		const query = {
			collectionId: "items",
			groupBy: "/status",
			sort: { field: "/title", direction: "ascending" as const },
			limit: 2,
		};
		const first = source.list(query);
		expect(first.items.map((item) => item.fields.title)).toEqual([
			"Delta",
			"Alpha",
		]);
		expect(first.next).toEqual(expect.any(String));
		await current.workspaces.addItem({
			workspace: current.workspace.id,
			itemId: "item-6",
			collectionId: "items",
			bindingId: "item",
			documentName: "Tracker Aaron",
			data: { id: "item-6", title: "Aaron", status: "todo" },
		});
		await current.workspaces.addItem({
			workspace: current.workspace.id,
			itemId: "item-7",
			collectionId: "items",
			bindingId: "item",
			documentName: "Tracker Zulu",
			data: { id: "item-7", title: "Zulu", status: "todo" },
		});
		await current.workspaces.deleteItem(current.workspace.id, "item-4");
		const second = source.list({ ...query, cursor: first.next });
		expect(second.items.map((item) => item.fields.title)).toEqual([
			"Charlie",
			"Zulu",
		]);
		const third = source.list({ ...query, cursor: second.next });
		expect(third.items.map((item) => item.fields.title)).toEqual([
			"Bravo",
			"Echo",
		]);
		expect(third.next).toBeUndefined();
		expect(third.total).toBe(6);
		expect(
			codeOf(() => source.list({ ...query, cursor: "not-a-cursor" })),
		).toBe("query_unsupported");
		expect(
			codeOf(() => source.list({ ...query, text: "a", cursor: first.next })),
		).toBe("query_unsupported");
	});

	it.each([
		{ order: "default order", sort: undefined },
		{
			order: "a sort with equal values",
			sort: { field: "/status", direction: "ascending" as const },
		},
	])(
		"skips no live item after deletes before the cursor, in $order",
		async ({ sort }) => {
			for (let index = 6; index <= 20; index += 1)
				await current.workspaces.addItem({
					workspace: current.workspace.id,
					itemId: `item-${index}`,
					collectionId: "items",
					bindingId: "item",
					documentName: `Tracker z${String(100 - index).padStart(3, "0")}`,
					data: { id: `item-${index}`, title: `Item ${index}`, status: "todo" },
				});
			const query = {
				collectionId: "items",
				...(sort ? { sort } : {}),
				limit: 5,
			};
			const read: string[] = [];
			let page = source.list(query);
			read.push(...page.items.map((item) => item.id));
			page = source.list({ ...query, cursor: page.next });
			read.push(...page.items.map((item) => item.id));
			for (const id of [read[1], read[3], read[8]])
				await current.workspaces.deleteItem(current.workspace.id, id ?? "");
			while (page.next !== undefined) {
				page = source.list({ ...query, cursor: page.next });
				read.push(...page.items.map((item) => item.id));
			}
			const all = source.list({ ...query, limit: 50 });
			expect(all.total).toBe(17);
			const unread = all.items
				.map((item) => item.id)
				.filter((id) => !read.includes(id));
			expect(unread).toEqual([]);
			expect(new Set(read).size).toBe(read.length);
			expect(read).toHaveLength(20);
		},
	);

	it("answers at most structuredWorkspaceMaxBatch items for a larger batch size", () => {
		for (let index = 0; index < 520; index += 1)
			current.store.addStructuredWorkspaceItem(current.workspace.id, {
				id: `bulk-${index}`,
				collectionId: "items",
				bindingId: "item",
				documentId: `bulk-doc-${index}`,
				documentName: `Bulk ${index}`,
				data: { title: `Bulk ${index}`, status: "todo" },
			});
		const page = source.list({ collectionId: "items", limit: 2000 });
		expect(page.items).toHaveLength(500);
		expect(page.total).toBe(525);
		const rest = source.list({
			collectionId: "items",
			limit: 2000,
			cursor: page.next,
		});
		expect(rest.items).toHaveLength(25);
		expect(rest.next).toBeUndefined();
		expect(codeOf(() => source.list({ collectionId: "items", limit: 0 }))).toBe(
			"query_unsupported",
		);
	});

	it("gets the current data and revision of an item, null for an unknown id", () => {
		expect(source.get("item-2")).toEqual({
			id: "item-2",
			revision: "1",
			bindingId: "item",
			data: {
				id: "item-2",
				title: "Bravo",
				status: "done",
				priority: 9,
				address: { city: "Lyon" },
			},
		});
		expect(source.get("missing")).toBeNull();
	});

	it("puts data at the expected revision and refuses a stale one", async () => {
		const put = source.put;
		if (!put) throw new Error("local source writes");
		const data = { title: "Alpha 2", status: "doing", priority: 3 };
		const updated = await put("item-1", data, "1");
		expect(updated).toMatchObject({ id: "item-1", revision: "2", data });
		expect(source.get("item-1")?.revision).toBe("2");
		const stale = await put("item-1", data, "1").then(
			() => null,
			(error: unknown) => error,
		);
		expect(isItemSourceError(stale) && stale.code).toBe("stale_revision");
		expect(isItemSourceError(stale) && stale.currentRevision).toBe("2");
		expect(await rejectionCode(put("missing", data, "1"))).toBe("unknown_item");
	});

	it("writes rows only: no item document is created, read or written", async () => {
		const put = source.put;
		const create = source.create;
		if (!put || !create) throw new Error("local source writes");
		const documentsBefore = [...current.documents.all().keys()];
		await put("item-1", { title: "Alpha 2", status: "doing" }, "1");
		await create({
			collectionId: "items",
			bindingId: "item",
			id: "item-6",
			data: { title: "Foxtrot", status: "todo" },
			document: { id: "doc-6", name: "Tracker Foxtrot" },
		});
		expect([...current.documents.all().keys()]).toEqual(documentsBefore);
		expect(current.documents.resolve("Tracker Alpha")).toBeNull();
		expect(current.store.loadOne("Tracker Alpha")).toBeNull();
		expect(
			current.store.loadStructuredWorkspaceItem(current.workspace.id, "item-1"),
		).toMatchObject({
			documentName: "Tracker Alpha",
			revision: 2,
			data: { title: "Alpha 2", status: "doing" },
		});
	});

	it("refuses a duplicate id and an item without its document as invalid records", async () => {
		const create = source.create;
		if (!create) throw new Error("local source creates");
		const duplicate = await create({
			collectionId: "items",
			bindingId: "item",
			id: "item-2",
			data: { title: "Again", status: "todo" },
			document: { id: "doc-again", name: "Tracker Again" },
		}).then(
			() => null,
			(error: unknown) => error,
		);
		expect(isItemSourceError(duplicate) && duplicate.code).toBe(
			"invalid_record",
		);
		expect((duplicate as Error).message).toBe(
			'Item "item-2" already exists in collection "items" of "Tracker" (document "Tracker Bravo"): an identity value is unique across the whole Workspace.',
		);
		expect(
			await rejectionCode(
				create({
					collectionId: "items",
					bindingId: "item",
					id: "item-7",
					data: { title: "Golf", status: "todo" },
				}),
			),
		).toBe("invalid_record");
	});

	it("keeps an invalid stored record listed with its issues", () => {
		current.store.putStructuredWorkspaceItem(
			current.workspace.id,
			"item-2",
			1,
			{
				status: "done",
			},
		);
		const page = source.list({ collectionId: "items", limit: 10 });
		expect(page.total).toBe(5);
		const bravo = page.items.find((item) => item.id === "item-2");
		expect(bravo?.fields).toEqual({ status: "done" });
		expect(bravo?.issues?.map((issue) => issue.message)).toEqual([
			"Invalid item data: must have required property 'title'",
			"Invalid item data: must have required property 'id'",
		]);
		expect(
			page.items
				.filter((item) => item.issues !== undefined)
				.map((item) => item.id),
		).toEqual(["item-2"]);
	});

	it("creates an item row last in its collection with the document that will render it", async () => {
		const create = source.create;
		if (!create) throw new Error("local source creates");
		const created = await create({
			collectionId: "items",
			bindingId: "item",
			id: "item-6",
			data: { title: "Foxtrot", status: "todo" },
			document: { id: "doc-6", name: "Tracker Foxtrot" },
		});
		expect(created).toEqual({
			id: "item-6",
			revision: "1",
			bindingId: "item",
			data: { title: "Foxtrot", status: "todo" },
		});
		const page = source.list({ collectionId: "items", limit: 10 });
		expect(page.total).toBe(6);
		expect(page.items.at(-1)?.id).toBe("item-6");
		expect(
			current.store.loadStructuredWorkspaceItem(current.workspace.id, "item-6"),
		).toMatchObject({
			sequence: 6,
			documentId: "doc-6",
			documentName: "Tracker Foxtrot",
		});
		expect(
			current.store.loadStructuredWorkspace(current.workspace.id)?.itemCounts,
		).toEqual({ items: 6 });
	});

	it("searches ignoring accents as well as case, on both sides", async () => {
		await current.workspaces.addItem({
			workspace: current.workspace.id,
			collectionId: "items",
			bindingId: "item",
			documentName: "Tracker Élève",
			data: { id: "item-6", title: "Élève déjà vu", status: "todo" },
		});
		const titles = (text: string) =>
			source
				.list({ collectionId: "items", text, limit: 10 })
				.items.map((item) => item.fields.title);
		expect(titles("eleve")).toEqual(["Élève déjà vu"]);
		expect(titles("DÉJA")).toEqual(["Élève déjà vu"]);
		expect(titles("ÉCHO")).toEqual(["Echo"]);
	});

	it("keys the cursor on the never-reused sequence: a new item after deleting the cursor row and every later row is read by that cursor", async () => {
		const first = source.list({ collectionId: "items", limit: 3 });
		expect(first.items.map((item) => item.id)).toEqual([
			"item-1",
			"item-2",
			"item-3",
		]);
		for (const id of ["item-4", "item-5", "item-3"])
			await current.workspaces.deleteItem(current.workspace.id, id);
		await current.workspaces.addItem({
			workspace: current.workspace.id,
			collectionId: "items",
			bindingId: "item",
			documentName: "Tracker Aaron",
			data: { id: "a-new", title: "Aaron", status: "todo" },
		});
		expect(
			current.store.loadStructuredWorkspaceItem(current.workspace.id, "a-new")
				?.sequence,
		).toBe(6);
		const rest = source.list({
			collectionId: "items",
			limit: 3,
			cursor: first.next,
		});
		expect(rest.items.map((item) => item.id)).toEqual(["a-new"]);
		expect(rest.next).toBeUndefined();
	});

	it("keys the cursor on the sort value then the id under a sort, ties by id", () => {
		const query = {
			collectionId: "items",
			sort: { field: "/status", direction: "ascending" as const },
			limit: 2,
		};
		const first = source.list(query);
		const second = source.list({ ...query, cursor: first.next });
		const third = source.list({ ...query, cursor: second.next });
		expect(
			[...first.items, ...second.items, ...third.items].map((item) => item.id),
		).toEqual(["item-4", "item-2", "item-5", "item-1", "item-3"]);
	});

	it("deletes an item, at the expected revision when given", async () => {
		const remove = source.delete;
		if (!remove) throw new Error("local source deletes");
		expect(await rejectionCode(remove("item-2", "7"))).toBe("stale_revision");
		await remove("item-2", "1");
		await remove("item-3");
		expect(source.get("item-2")).toBeNull();
		expect(source.list({ collectionId: "items", limit: 10 }).total).toBe(3);
		expect(await rejectionCode(remove("item-2"))).toBe("unknown_item");
	});

	it("announces a refresh on the bus and stops serving once closed", async () => {
		const changes: unknown[] = [];
		current.bus.on("structured-workspace:source-changed", (change) => {
			changes.push(change);
		});
		await source.refresh({ scope: "index" });
		await source.refresh({ scope: "item", id: "item-1" });
		expect(changes).toEqual([
			{ workspaceId: current.workspace.id, scope: "index" },
			{ workspaceId: current.workspace.id, scope: "item", itemId: "item-1" },
		]);
		await source.close();
		expect(codeOf(() => source.get("item-1"))).toBe("source_unreachable");
	});
});
