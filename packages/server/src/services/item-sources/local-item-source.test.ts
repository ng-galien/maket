import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBus } from "../bus.js";
import { createDocumentStates } from "../document-states.js";
import { createDocuments } from "../documents.js";
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
	},
	required: ["title", "status"],
	additionalProperties: false,
};

const rows = [
	{ title: "Alpha", status: "todo", priority: 2 },
	{ title: "Bravo", status: "done", priority: 9 },
	{ title: "Charlie", status: "todo", priority: 5 },
	{ title: "Delta", status: "doing" },
	{ title: "Echo", status: "done", priority: 1 },
];

function setup() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, bus, documents });
	const deps = { store, bus, documents, documentStates };
	const itemSources: ItemSources = createItemSources({
		...deps,
		get structuredWorkspaces() {
			return workspaces;
		},
	});
	const workspaces: StructuredWorkspaces = createStructuredWorkspaces({
		...deps,
		itemSources,
	});
	const workspace = workspaces.create({
		name: "Tracker",
		dataSchema,
		representationSchema: {
			version: 1,
			collections: {
				items: { name: "Items", groupBy: "/status", groupOrder: ["doing"] },
			},
		},
	});
	for (const [index, row] of rows.entries()) {
		workspaces.addItem({
			workspace: workspace.id,
			itemId: `item-${index + 1}`,
			collectionId: "items",
			bindingId: "item",
			documentName: `Tracker ${row.title}`,
			data: { ...row, address: { city: "Lyon" } },
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
	let current: ReturnType<typeof setup>;
	let source: ItemSource;

	beforeEach(() => {
		current = setup();
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
			search: false,
			sort: "memory",
			total: "exact",
			changes: "poll",
			revisions: "local",
		});
	});

	it("lists every item in position order with an exact total", () => {
		const page = source.list({
			collectionId: "items",
			limit: Number.POSITIVE_INFINITY,
		});
		expect(page.items.map((item) => item.id)).toEqual([
			"item-1",
			"item-2",
			"item-3",
			"item-4",
			"item-5",
		]);
		expect(page.total).toBe(5);
		expect(page.cursor).toEqual({ offset: 0 });
		expect(page.groups).toBeUndefined();
		expect(page.items[0]).toMatchObject({
			revision: "1",
			bindingId: "item",
		});
	});

	it("keeps in summaries only the fields the index reads", () => {
		const [first] = source.list({ collectionId: "items", limit: 1 }).items;
		expect(first?.fields).toEqual({
			title: "Alpha",
			status: "todo",
			priority: 2,
		});
		expect(source.get("item-1")?.data).toEqual({
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
			limit: Number.POSITIVE_INFINITY,
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

	it("pages with an offset cursor", () => {
		const first = source.list({ collectionId: "items", limit: 2 });
		expect(first.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
		expect(first.cursor).toEqual({ offset: 0, next: "2" });
		const second = source.list({
			collectionId: "items",
			limit: 2,
			cursor: first.cursor.next,
		});
		expect(second.items.map((item) => item.id)).toEqual(["item-3", "item-4"]);
		expect(second.cursor).toEqual({ offset: 2, next: "4", previous: "0" });
		const last = source.list({ collectionId: "items", limit: 2, cursor: "4" });
		expect(last.items.map((item) => item.id)).toEqual(["item-5"]);
		expect(last.cursor).toEqual({ offset: 4, previous: "2" });
		expect(last.total).toBe(5);
		expect(
			codeOf(() =>
				source.list({ collectionId: "items", limit: 2, cursor: "x" }),
			),
		).toBe("query_unsupported");
	});

	it("refuses search and filters it does not support", () => {
		expect(
			codeOf(() =>
				source.list({ collectionId: "items", text: "alpha", limit: 5 }),
			),
		).toBe("query_unsupported");
		expect(
			codeOf(() =>
				source.list({
					collectionId: "items",
					filters: [{ field: "status", op: "eq", value: "todo" }],
					limit: 5,
				}),
			),
		).toBe("query_unsupported");
	});

	it("gets the current data and revision of an item, null for an unknown id", () => {
		expect(source.get("item-2")).toEqual({
			id: "item-2",
			revision: "1",
			bindingId: "item",
			data: {
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

	it("answers like update_item: the lock before the revision, refusals with their code and message", async () => {
		const put = source.put;
		const create = source.create;
		if (!put || !create) throw new Error("local source writes");
		const data = { title: "Alpha 2", status: "doing" };
		const document = current.documents.all().get("Tracker Alpha");
		if (!document) throw new Error("item document");
		document.meta.locked = true;
		const lockedStale = await put("item-1", data, "9").then(
			() => null,
			(error: unknown) => error,
		);
		expect(isItemSourceError(lockedStale) && lockedStale.code).toBe(
			"read_only",
		);
		expect((lockedStale as Error).message).toBe(
			'Document "Tracker Alpha" is locked. Unlock it before changing its Workspace.',
		);
		expect(await rejectionCode(put("item-1", data, "1"))).toBe("read_only");
		document.meta.locked = false;
		const invalid = await put("item-1", { status: "todo" }, "1").then(
			() => null,
			(error: unknown) => error,
		);
		expect(isItemSourceError(invalid) && invalid.code).toBe("invalid_record");
		expect((invalid as Error).message).toMatch(
			/^Item data breaks the schema \(1 issue\(s\)\):/,
		);
		const duplicate = await create({
			collectionId: "items",
			bindingId: "item",
			id: "item-2",
			data: { title: "Again", status: "todo" },
		}).then(
			() => null,
			(error: unknown) => error,
		);
		expect(isItemSourceError(duplicate) && duplicate.code).toBe(
			"invalid_record",
		);
		expect((duplicate as Error).message).toBe(
			'Item "item-2" already exists in "Tracker".',
		);
	});

	it("keeps an invalid stored record listed with its issues", () => {
		const document = current.documents.all().get("Tracker Bravo");
		if (!document) throw new Error("item document");
		current.store.appendDocumentStateRevision(document.id, 1, {
			status: "done",
		});
		const page = source.list({ collectionId: "items", limit: 10 });
		expect(page.total).toBe(5);
		const bravo = page.items.find((item) => item.id === "item-2");
		expect(bravo?.fields).toEqual({ status: "done" });
		expect(bravo?.issues?.map((issue) => issue.rule)).toEqual(["required"]);
		expect(
			page.items
				.filter((item) => item.issues !== undefined)
				.map((item) => item.id),
		).toEqual(["item-2"]);
	});

	it("creates an item through the workspace mutations", async () => {
		const create = source.create;
		if (!create) throw new Error("local source creates");
		const created = await create({
			collectionId: "items",
			bindingId: "item",
			id: "item-6",
			data: { title: "Foxtrot", status: "todo" },
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
			current.workspaces.get(current.workspace.id)?.items.at(-1)?.documentName,
		).toBe("Tracker — Items — item-6");
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
