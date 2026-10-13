import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBus } from "./bus.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createItemSources } from "./item-sources/item-sources.js";
import { createItemWindows, type ItemWindows } from "./item-windows.js";
import { createSQLiteStore } from "./store.js";
import {
	createStructuredWorkspaces,
	type StructuredWorkspaces,
} from "./structured-workspaces.js";

const dataSchema = {
	type: "object",
	properties: {
		title: { type: "string" },
		status: { type: "string" },
		id: { type: "string" },
	},
	required: ["title", "status", "id"],
	additionalProperties: false,
};

async function setup() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, bus, documents });
	const itemSources = createItemSources({ store, bus, documents });
	const itemWindows: ItemWindows = createItemWindows({
		store,
		bus,
		itemSources,
	});
	const workspaces: StructuredWorkspaces = createStructuredWorkspaces({
		store,
		bus,
		documents,
		documentStates,
		itemSources,
		itemWindows,
	});
	const workspace = workspaces.create({
		name: "Tasks",
		dataSchema,
		representationSchema: {
			version: 1,
			collections: {
				items: { name: "Items", identity: "/id", indexPageSize: 3 },
			},
		},
	});
	for (let index = 1; index <= 7; index += 1)
		await workspaces.addItem({
			workspace: workspace.id,
			itemId: `task-${index}`,
			collectionId: "items",
			bindingId: "item",
			documentName: `Task ${index}`,
			data: {
				id: `task-${index}`,
				title: `Task ${index}`,
				status: index % 2 ? "open" : "closed",
			},
		});
	const changes: Array<{ workspaceId: string; collectionId: string }> = [];
	bus.on("structured-workspace:window-changed", (change) =>
		changes.push(change),
	);
	return { store, bus, workspaces, workspace, itemWindows, changes };
}

const ids = (window: { items: Array<{ id: string }> }) =>
	window.items.map((item) => item.id);

describe("ItemWindows", () => {
	let current: Awaited<ReturnType<typeof setup>>;

	beforeEach(async () => {
		current = await setup();
	});

	afterEach(() => {
		current.store.close();
	});

	it("opens a window on first read with the first batch of indexPageSize items, the total and the next cursor", () => {
		const window = current.itemWindows.current(current.workspace.id, "items");
		expect(ids(window)).toEqual(["task-1", "task-2", "task-3"]);
		expect(window).toMatchObject({
			workspaceId: current.workspace.id,
			collectionId: "items",
			query: {},
			total: 7,
			next: expect.any(String),
			fetchedAt: expect.any(String),
		});
		expect(window.items[0]).toMatchObject({
			documentName: "Task 1",
			revision: "1",
			fields: { title: "Task 1", status: "open" },
		});
		expect(current.changes).toEqual([]);
	});

	it("replaces the window with a new query and extends it with its cursor, announcing each change", () => {
		const { window: searched, batch } = current.itemWindows.query(
			current.workspace.id,
			"items",
			{ text: " open " },
		);
		expect(searched.query).toEqual({ text: "open" });
		expect(ids(searched)).toEqual(["task-1", "task-3", "task-5"]);
		expect(batch).toEqual(searched.items);
		expect(searched.total).toBe(4);
		const extended = current.itemWindows.query(current.workspace.id, "items", {
			cursor: searched.next,
		});
		expect(extended.batch.map((item) => item.id)).toEqual(["task-7"]);
		expect(ids(extended.window)).toEqual([
			"task-1",
			"task-3",
			"task-5",
			"task-7",
		]);
		expect(extended.window.next).toBeUndefined();
		expect(current.itemWindows.current(current.workspace.id, "items")).toBe(
			extended.window,
		);
		expect(current.itemWindows.all()).toEqual([extended.window]);
		expect(current.changes).toEqual([
			{ workspaceId: current.workspace.id, collectionId: "items" },
			{ workspaceId: current.workspace.id, collectionId: "items" },
		]);
		const restarted = current.itemWindows.query(current.workspace.id, "items", {
			filters: [{ field: "/status", op: "eq", value: "closed" }],
		});
		expect(ids(restarted.window)).toEqual(["task-2", "task-4", "task-6"]);
		expect(restarted.window.next).toBeUndefined();
	});

	it("reads the window again, as far as it reached, when the source changes", async () => {
		const first = current.itemWindows.current(current.workspace.id, "items");
		current.itemWindows.query(current.workspace.id, "items", {
			cursor: first.next,
		});
		current.changes.length = 0;
		await current.workspaces.updateItem(current.workspace.id, "task-2", 1, {
			id: "task-2",
			title: "Task 2 renamed",
			status: "closed",
		});
		const reread = current.itemWindows.current(current.workspace.id, "items");
		expect(ids(reread)).toEqual([
			"task-1",
			"task-2",
			"task-3",
			"task-4",
			"task-5",
			"task-6",
		]);
		expect(reread.items[1]).toMatchObject({
			revision: "2",
			fields: { title: "Task 2 renamed" },
		});
		expect(current.changes).toEqual([
			{ workspaceId: current.workspace.id, collectionId: "items" },
		]);
		await current.workspaces.deleteItem(current.workspace.id, "task-1");
		expect(
			ids(current.itemWindows.current(current.workspace.id, "items")),
		).toEqual(["task-2", "task-3", "task-4", "task-5", "task-6", "task-7"]);
	});

	it("reads the window again under a new definition and forgets it with its workspace", () => {
		current.itemWindows.current(current.workspace.id, "items");
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
						indexPageSize: 3,
						sortBy: "/title",
						sortDirection: "descending",
					},
				},
			},
		});
		expect(
			ids(current.itemWindows.current(current.workspace.id, "items")),
		).toEqual(["task-7", "task-6", "task-5"]);
		current.workspaces.delete(current.workspace.id);
		expect(current.itemWindows.all()).toEqual([]);
	});
});
