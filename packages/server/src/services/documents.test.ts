import { describe, expect, it } from "vitest";
import { DocumentModel } from "../types.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";

function makeDoc(name: string, category = "general") {
	return new DocumentModel({
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
		store.close();
	});
});
