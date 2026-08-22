import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../types.js";
import { createBus } from "./bus.js";
import { createCollectionCursors } from "./collection-cursor.js";
import { createCollections } from "./collections.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";

const clientSchema = {
	type: "object",
	properties: { client_name: { type: "string" } },
	required: ["client_name"],
	additionalProperties: false,
};

function makeDeps() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const collections = createCollections({ store, bus, documents });
	const cursors = createCollectionCursors({ bus, documents, store });
	collections.save({
		name: "clients",
		schema: clientSchema,
		members: [
			{ id: "member_1", position: 0, data: { client_name: "Acme" } },
			{ id: "member_2", position: 1, data: { client_name: "Globex" } },
		],
	});
	const doc = createDocument({
		name: "poster",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		pages: [
			{
				id: "page_1",
				name: "Page 1",
				elements: [],
				collection: { name: "clients" },
			},
			{ id: "page_2", name: "Page 2", elements: [] },
		],
	});
	store.saveDoc(doc);
	documents.loadAll();
	return { store, bus, documents, collections, cursors };
}

describe("CollectionCursors service", () => {
	it("defaults a bound page to single-row mode on the first row", () => {
		const { store, cursors } = makeDeps();
		expect(cursors.resolve("poster", 0)).toEqual({
			docName: "poster",
			pageIndex: 0,
			collection: "clients",
			mode: "rendered",
			memberId: "member_1",
		});
		store.close();
	});

	it("restores the page render mode and row after recreating the service", () => {
		const { store, cursors } = makeDeps();
		cursors.set("poster", 0, { mode: "all", memberId: "member_2" });

		const bus = createBus();
		const documents = createDocuments({ store });
		documents.loadAll();
		const restored = createCollectionCursors({ bus, documents, store });

		expect(restored.resolve("poster", 0)).toEqual({
			docName: "poster",
			pageIndex: 0,
			collection: "clients",
			mode: "all",
			memberId: "member_2",
		});
		store.close();
	});

	it("returns null for unbound pages and unknown documents", () => {
		const { store, cursors } = makeDeps();
		expect(cursors.resolve("poster", 1)).toBeNull();
		expect(cursors.resolve("ghost", 0)).toBeNull();
		store.close();
	});

	it("moves mode and member independently and emits on change", () => {
		const { store, bus, cursors } = makeDeps();
		const changed = vi.fn();
		bus.on("collection-cursor:changed", changed);

		const moved = cursors.set("poster", 0, { mode: "all" });
		expect(moved.mode).toBe("all");
		expect(moved.memberId).toBe("member_1");
		expect(changed).toHaveBeenCalledTimes(1);

		const onRow = cursors.set("poster", 0, { memberId: "member_2" });
		expect(onRow.mode).toBe("all");
		expect(onRow.memberId).toBe("member_2");
		expect(changed).toHaveBeenCalledTimes(2);

		cursors.set("poster", 0, { memberId: "member_2" });
		expect(changed).toHaveBeenCalledTimes(2);
		store.close();
	});

	it("rejects unknown rows, unbound pages and missing documents", () => {
		const { store, cursors } = makeDeps();
		expect(() => cursors.set("poster", 0, { memberId: "ghost" })).toThrow(
			'Row "ghost" not found',
		);
		expect(() => cursors.set("poster", 1, { mode: "all" })).toThrow(
			"has no data source",
		);
		expect(() => cursors.set("ghost", 0, { mode: "all" })).toThrow(
			'Document "ghost" not found',
		);
		expect(() => cursors.set("poster", 9, { mode: "all" })).toThrow(
			"Page 10 not found",
		);
		store.close();
	});

	it("keeps cursors independent per page and per document", () => {
		const { store, documents, cursors } = makeDeps();
		const doc = createDocument({
			name: "flyer",
			canvas: {
				format: "A5",
				orientation: "portrait",
				w: 148,
				h: 210,
				bg: "#fff",
			},
			pages: [
				{
					id: "page_1",
					name: "Page 1",
					elements: [],
					collection: { name: "clients" },
				},
			],
		});
		store.saveDoc(doc);
		documents.loadAll();

		cursors.set("poster", 0, { mode: "rendered", memberId: "member_2" });
		expect(cursors.resolve("flyer", 0)?.mode).toBe("rendered");
		expect(cursors.resolve("flyer", 0)?.memberId).toBe("member_1");
		expect(cursors.resolve("poster", 0)?.memberId).toBe("member_2");
		store.close();
	});

	it("keeps each cursor attached to its page across reorder and removal", () => {
		const { store, bus, documents, cursors } = makeDeps();
		const doc = documents.resolve("poster");
		if (!doc) throw new Error("fixture document missing");
		const secondPage = doc.pages[1];
		if (!secondPage) throw new Error("fixture page missing");
		doc.pages[1] = {
			...secondPage,
			id: "page_2",
			collection: { name: "clients" },
		};
		cursors.set("poster", 0, { mode: "rendered", memberId: "member_1" });
		cursors.set("poster", 1, { mode: "rendered", memberId: "member_2" });

		doc.pages.reverse();
		bus.emit("document:loaded", { docName: doc.name });

		expect(cursors.resolve("poster", 0)?.memberId).toBe("member_2");
		expect(cursors.resolve("poster", 1)?.memberId).toBe("member_1");

		doc.pages.splice(0, 1);
		bus.emit("document:loaded", { docName: doc.name });

		expect(cursors.snapshot()).toEqual([
			expect.objectContaining({
				pageIndex: 0,
				memberId: "member_1",
			}),
		]);
		store.close();
	});

	it("clamps the member when the current row disappears", () => {
		const { store, bus, collections, cursors } = makeDeps();
		const changed = vi.fn();
		cursors.set("poster", 0, { mode: "rendered", memberId: "member_2" });
		bus.on("collection-cursor:changed", changed);

		collections.deleteRow("clients", "member_2");

		expect(changed).toHaveBeenCalled();
		expect(cursors.resolve("poster", 0)?.memberId).toBe("member_1");
		store.close();
	});

	it("returns to template mode when the last row disappears", () => {
		const { store, collections, cursors } = makeDeps();
		cursors.set("poster", 0, { mode: "rendered", memberId: "member_2" });

		collections.deleteRow("clients", "member_2");
		collections.deleteRow("clients", "member_1");

		expect(cursors.resolve("poster", 0)).toEqual(
			expect.objectContaining({ mode: "template", memberId: null }),
		);
		store.close();
	});

	it("rejects rendered and all modes for an empty collection", () => {
		const { store, collections, cursors } = makeDeps();
		collections.save({ name: "empty", schema: clientSchema, members: [] });
		collections.bindPage("poster", 1, "empty");

		expect(() => cursors.set("poster", 1, { mode: "rendered" })).toThrow(
			'Collection "empty" has no rows',
		);
		expect(() => cursors.set("poster", 1, { mode: "all" })).toThrow(
			'Collection "empty" has no rows',
		);
		expect(cursors.resolve("poster", 1)).toEqual(
			expect.objectContaining({ mode: "template", memberId: null }),
		);
		store.close();
	});

	it("drops the cursor when the page binding is cleared", () => {
		const { store, collections, cursors } = makeDeps();
		cursors.set("poster", 0, { mode: "all" });

		collections.clearPageBinding("poster", 0);

		expect(cursors.resolve("poster", 0)).toBeNull();
		expect(cursors.snapshot()).toEqual([]);
		store.close();
	});

	it("resets the cursor when the page is rebound to another collection", () => {
		const { store, collections, cursors } = makeDeps();
		collections.save({
			name: "products",
			schema: clientSchema,
			members: [{ id: "p_1", position: 0, data: { client_name: "Widget" } }],
		});
		cursors.set("poster", 0, { mode: "rendered", memberId: "member_2" });

		collections.bindPage("poster", 0, "products");

		expect(cursors.resolve("poster", 0)).toEqual(
			expect.objectContaining({
				collection: "products",
				mode: "rendered",
				memberId: "p_1",
			}),
		);
		store.close();
	});

	it("snapshots every bound page across loaded documents", () => {
		const { store, cursors } = makeDeps();
		cursors.set("poster", 0, { mode: "all" });
		expect(cursors.snapshot()).toEqual([
			expect.objectContaining({
				docName: "poster",
				pageIndex: 0,
				collection: "clients",
				mode: "all",
			}),
		]);
		store.close();
	});
});
