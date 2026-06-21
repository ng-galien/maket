import { describe, expect, it } from "vitest";
import { createDocument } from "../types.js";
import { createSQLiteStore } from "./store.js";

function makeDoc(name: string) {
	return createDocument({
		name,
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
	});
}

describe("SQLiteStore", () => {
	it("creates a usable store against :memory:", () => {
		const store = createSQLiteStore(":memory:");
		expect(store.isEmpty()).toBe(true);
		store.close();
	});

	it("round-trips a document (save → loadOne)", () => {
		const store = createSQLiteStore(":memory:");
		const d = makeDoc("poster");
		store.saveDoc(d);

		const loaded = store.loadOne("poster");
		expect(loaded).not.toBeNull();
		expect(loaded?.name).toBe("poster");
		expect(loaded?.canvas.format).toBe("A4");
		store.close();
	});

	it("preserves page ids across save and load", () => {
		const store = createSQLiteStore(":memory:");
		const d = createDocument({
			...makeDoc("pages"),
			pages: [
				{ id: "page-a", name: "A", elements: [], html: "<p>A</p>" },
				{ id: "page-b", name: "B", elements: [], html: "<p>B</p>" },
			],
		});
		store.saveDoc(d);

		const loaded = store.loadOne("pages");
		expect(loaded?.pages.map((p) => p.id)).toEqual(["page-a", "page-b"]);
		store.close();
	});

	it("loadAll returns every saved document", () => {
		const store = createSQLiteStore(":memory:");
		store.saveDocs([makeDoc("a"), makeDoc("b"), makeDoc("c")]);

		const all = store.loadAll();
		expect(all.map((d) => d.name).sort()).toEqual(["a", "b", "c"]);
		store.close();
	});

	it("loadById resolves by document UUID", () => {
		const store = createSQLiteStore(":memory:");
		const d = makeDoc("byId");
		store.saveDoc(d);

		const loaded = store.loadById(d.id);
		expect(loaded?.name).toBe("byId");
		store.close();
	});

	it("deleteDoc removes a document", () => {
		const store = createSQLiteStore(":memory:");
		store.saveDoc(makeDoc("gone"));
		store.deleteDoc("gone");
		expect(store.loadOne("gone")).toBeNull();
		store.close();
	});

	it("saves and loads chartes", () => {
		const store = createSQLiteStore(":memory:");
		store.saveCharte({
			name: "brand",
			description: "Primary",
			tokens: { color: { primary: "#ff0" } },
		});

		const all = store.loadAllChartes();
		expect(all).toHaveLength(1);
		expect(all[0]?.name).toBe("brand");

		const one = store.loadCharte("brand");
		expect(one?.tokens.color?.primary).toBe("#ff0");
		store.close();
	});

	it("deleteCharte returns true when a charte existed", () => {
		const store = createSQLiteStore(":memory:");
		store.saveCharte({ name: "x", tokens: {} });
		expect(store.deleteCharte("x")).toBe(true);
		expect(store.deleteCharte("x")).toBe(false);
		store.close();
	});

	it("saves and loads assets with tag serialization", () => {
		const store = createSQLiteStore(":memory:");
		store.saveAsset({
			filename: "logo.png",
			title: "Logo",
			tags: ["brand", "primary"],
		});
		const a = store.loadAsset("logo.png");
		expect(a?.title).toBe("Logo");
		expect(a?.tags).toEqual(["brand", "primary"]);
		store.close();
	});

	it("deleteAsset returns true when an asset existed", () => {
		const store = createSQLiteStore(":memory:");
		store.saveAsset({ filename: "a.png" });
		expect(store.deleteAsset("a.png")).toBe(true);
		expect(store.deleteAsset("a.png")).toBe(false);
		store.close();
	});

	it("isEmpty becomes false once a doc is saved", () => {
		const store = createSQLiteStore(":memory:");
		expect(store.isEmpty()).toBe(true);
		store.saveDoc(makeDoc("x"));
		expect(store.isEmpty()).toBe(false);
		store.close();
	});
});
