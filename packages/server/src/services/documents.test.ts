import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../types.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";

function makeDoc(name: string, category = "general") {
	return createDocument({
		name,
		category,
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
	});
}

describe("documents service", () => {
	it("loadAll hydrates the in-memory registry from the store", () => {
		const store = createSQLiteStore(":memory:");
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));

		const docs = createDocuments({ store });
		docs.loadAll();

		expect(docs.resolve("a")?.name).toBe("a");
		expect(docs.resolve("b")?.name).toBe("b");
		expect(docs.all().size).toBe(2);
		store.close();
	});

	it("resolve returns null for an unknown document", () => {
		const store = createSQLiteStore(":memory:");
		const docs = createDocuments({ store });
		expect(docs.resolve("missing")).toBeNull();
		store.close();
	});

	it("resolveOrLoad falls back to the store and caches the hit", () => {
		const store = createSQLiteStore(":memory:");
		store.saveDoc(makeDoc("persisted"));

		const docs = createDocuments({ store });
		// Not loaded yet
		expect(docs.all().size).toBe(0);

		const first = docs.resolveOrLoad("persisted");
		expect(first?.name).toBe("persisted");
		expect(docs.all().size).toBe(1); // cached

		// Second call returns cached instance (same reference)
		expect(docs.resolveOrLoad("persisted")).toBe(first);
		store.close();
	});

	it("persist writes the cached instance to the store", () => {
		const store = createSQLiteStore(":memory:");
		const docs = createDocuments({ store });
		const d = makeDoc("draft");
		docs.all().set(d.name, d);

		docs.persist("draft");

		const reloaded = store.loadOne("draft");
		expect(reloaded?.name).toBe("draft");
		store.close();
	});

	it("persist is a no-op when the document is not in memory", () => {
		const store = createSQLiteStore(":memory:");
		const docs = createDocuments({ store });
		// Should not throw
		docs.persist("ghost");
		expect(store.isEmpty()).toBe(true);
		store.close();
	});

	it("rejects an invalid state template and restores the cached document", () => {
		const store = createSQLiteStore(":memory:");
		const doc = makeDoc("living");
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html = '<p data-id="title">{{ state.title }}</p>';
		store.saveDoc(doc);
		store.initializeDocumentState(
			doc.id,
			{
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			{ title: "Safe" },
		);
		const docs = createDocuments({ store });
		docs.loadAll();
		const cached = docs.resolve("living");
		if (!cached?.pages[0]) throw new Error("Fixture page missing.");
		cached.pages[0].html = '<p data-id="bad">{{ page.number }}</p>';

		expect(() => docs.persist("living")).toThrow(/state namespace/);
		expect(docs.resolve("living")?.pages[0]?.html).toContain("state.title");
		expect(store.loadOne("living")?.pages[0]?.html).toContain("state.title");
		store.close();
	});

	it("delete removes from both the store and memory", () => {
		const store = createSQLiteStore(":memory:");
		const d = makeDoc("to-delete");
		store.saveDoc(d);

		const docs = createDocuments({ store });
		docs.loadAll();

		docs.delete("to-delete");

		expect(docs.resolve("to-delete")).toBeNull();
		expect(store.loadOne("to-delete")).toBeNull();
		store.close();
	});

	it("list produces summaries for every cached document", () => {
		const store = createSQLiteStore(":memory:");
		const a = makeDoc("a", "poster");
		const firstPage = a.pages[0];
		if (!firstPage) throw new Error("Fixture page missing.");
		firstPage.collection = { name: "clients" };
		a.pages.push(
			{
				...firstPage,
				id: "a-page-2",
				name: "Clients 2",
				collection: { name: "clients" },
			},
			{
				...firstPage,
				id: "a-page-3",
				name: "Offers",
				collection: { name: "offers" },
			},
		);
		const b = makeDoc("b", "flyer");
		store.saveDocs([a, b]);

		const docs = createDocuments({ store });
		docs.loadAll();

		const names = docs
			.list()
			.map((s) => s.name)
			.sort();
		expect(names).toEqual(["a", "b"]);
		const summaryA = docs.list().find((s) => s.name === "a");
		expect(summaryA?.category).toBe("poster");
		expect(summaryA?.format).toBe("A4");
		expect(summaryA?.collectionBindings).toEqual([
			{ name: "clients", pageCount: 2 },
			{ name: "offers", pageCount: 1 },
		]);
		store.close();
	});

	it("restores cached categories when an atomic category move fails", () => {
		const store = createSQLiteStore(":memory:");
		store.saveDocs([
			makeDoc("root", "Products/Heroes"),
			makeDoc("child", "Products/Heroes/Portraits"),
		]);
		const docs = createDocuments({ store });
		docs.loadAll();
		vi.spyOn(store, "saveDocs").mockImplementationOnce(() => {
			throw new Error("transaction failed");
		});

		expect(() =>
			docs.moveCategory("Products/Heroes", "Campaigns/Heroes"),
		).toThrow("transaction failed");

		expect(docs.resolve("root")?.category).toBe("Products/Heroes");
		expect(docs.resolve("child")?.category).toBe("Products/Heroes/Portraits");
		expect(store.loadOne("root")?.category).toBe("Products/Heroes");
		store.close();
	});
});
