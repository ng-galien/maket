import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSQLiteStore, type Store } from "../store.js";

describe("Structured Workspace item rows", () => {
	let store: Store;

	beforeEach(() => {
		store = createSQLiteStore(":memory:");
		store.createStructuredWorkspace({
			id: "ws",
			name: "Rows",
			dataSchema: { type: "object" },
			representationSchema: { version: 1, collections: {} },
		});
		for (const id of ["one", "two"])
			store.addStructuredWorkspaceItem("ws", {
				id,
				collectionId: "items",
				bindingId: "item",
				documentId: `doc-${id}`,
				documentName: `Row ${id}`,
				data: { title: id },
			});
	});

	afterEach(() => {
		store.close();
	});

	it("inserts last in the collection at revision 1 and reads one row with its data", () => {
		expect(store.loadStructuredWorkspaceItem("ws", "two")).toEqual({
			id: "two",
			position: 1,
			collectionId: "items",
			bindingId: "item",
			documentId: "doc-two",
			documentName: "Row two",
			data: { title: "two" },
			revision: 1,
		});
		expect(store.loadStructuredWorkspaceItem("ws", "missing")).toBeNull();
		expect(
			store.loadStructuredWorkspaceItemByDocumentName("Row one"),
		).toMatchObject({ workspaceId: "ws", item: { id: "one" } });
		expect(
			store
				.loadStructuredWorkspaceCollectionItems("ws", "items")
				.map(({ id }) => id),
		).toEqual(["one", "two"]);
	});

	it("puts at the expected revision, else answers the current row", () => {
		const written = store.putStructuredWorkspaceItem("ws", "one", 1, {
			title: "edited",
		});
		expect(written).toMatchObject({
			written: true,
			item: { revision: 2, data: { title: "edited" } },
		});
		expect(
			store.putStructuredWorkspaceItem("ws", "one", 1, { title: "late" }),
		).toMatchObject({
			written: false,
			current: { revision: 2, data: { title: "edited" } },
		});
		expect(store.putStructuredWorkspaceItem("ws", "missing", 1, {})).toEqual({
			written: false,
			current: null,
		});
	});

	it("deletes at the expected revision when given and compacts positions", () => {
		expect(store.deleteStructuredWorkspaceItem("ws", "one", 5)).toBe(false);
		expect(store.deleteStructuredWorkspaceItem("ws", "one", 1)).toBe(true);
		expect(store.loadStructuredWorkspaceItem("ws", "two")?.position).toBe(0);
		expect(store.deleteStructuredWorkspaceItem("ws", "two")).toBe(true);
		expect(store.deleteStructuredWorkspaceItem("ws", "two")).toBe(false);
	});
});
