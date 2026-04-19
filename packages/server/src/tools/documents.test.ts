import { describe, expect, it, vi } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { DocumentModel } from "../types.js";
import { createMaketDocTool, documentsPack } from "./documents.js";

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	return { store, bus, documents };
}

// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
const NO_EXTRA = {} as any;

function makeDoc(name: string, pageCount = 1) {
	const pages = Array.from({ length: pageCount }, (_, i) => ({
		name: `P${i + 1}`,
		elements: [],
		html: `<div data-id="e${i}">x</div>`,
	}));
	return new DocumentModel({
		name,
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		pages,
	});
}

describe("documentsPack — registration", () => {
	it("declares id and deps", () => {
		expect(documentsPack.id).toBe("documents");
		expect(documentsPack.requires).toEqual(
			expect.arrayContaining(["documents", "bus"]),
		);
	});
});

describe("maket_doc — action=new", () => {
	it("creates a new document with canvas + charte and emits events", async () => {
		const { store, bus, documents } = fixture();
		const created = vi.fn();
		const toast = vi.fn();
		bus.on("document:created", created);
		bus.on("toast", toast);

		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{
				action: "new",
				doc: "d1",
				format: "A4",
				orientation: "portrait",
				charte: "brand",
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const d = documents.resolve("d1");
		expect(d?.canvas.format).toBe("A4");
		expect(d?.meta.charte).toBe("brand");
		expect(created).toHaveBeenCalledWith({ docName: "d1" });
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ level: "success" }),
		);
		expect(store.loadOne("d1")?.name).toBe("d1");
		store.close();
	});

	it("defaults format to A3 portrait and category to general", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "new", doc: "d2" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		const d = documents.resolve("d2");
		expect(d?.canvas.format).toBe("A3");
		expect(d?.canvas.orientation).toBe("portrait");
		expect(d?.category).toBe("general");
		store.close();
	});

	it("errors when doc is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "new" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the name already exists", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("dup"));
		documents.loadAll();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "new", doc: "dup" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=focus", () => {
	it("sets the active page and emits document:loaded", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d", 3));
		documents.loadAll();
		const loaded = vi.fn();
		bus.on("document:loaded", loaded);

		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "focus", doc: "d", page: 2 },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(documents.resolve("d")?.activePage).toBe(1);
		expect(loaded).toHaveBeenCalledWith({ docName: "d" });
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "focus", doc: "ghost", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the page is out of range", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d", 2));
		documents.loadAll();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "focus", doc: "d", page: 99 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when required args are missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "focus" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=list", () => {
	it("groups documents by category", async () => {
		const { store, bus, documents } = fixture();
		const a = makeDoc("a");
		a.category = "affiches";
		const b = makeDoc("b");
		b.category = "affiches";
		const c = makeDoc("c");
		c.category = "tracts";
		store.saveDoc(a);
		store.saveDoc(b);
		store.saveDoc(c);
		documents.loadAll();

		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/affiches \(2\)/);
		expect(txt).toMatch(/tracts \(1\)/);
		store.close();
	});

	it("returns placeholder when no documents", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toBe("No documents.");
		store.close();
	});
});

describe("maket_doc — action=delete", () => {
	it("refuses to delete the only document", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("solo"));
		documents.loadAll();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "delete", doc: "solo" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("deletes an existing document and emits events", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();

		const deleted = vi.fn();
		const toast = vi.fn();
		bus.on("document:deleted", deleted);
		bus.on("toast", toast);

		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "delete", doc: "a" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		expect(documents.resolve("a")).toBeNull();
		expect(store.loadOne("a")).toBeNull();
		expect(deleted).toHaveBeenCalledWith({ docName: "a" });
		expect(toast).toHaveBeenCalled();
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "delete", doc: "ghost" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=duplicate", () => {
	it("clones a document with a new name", async () => {
		const { store, bus, documents } = fixture();
		const src = makeDoc("orig", 2);
		src.meta.charte = "brand";
		store.saveDoc(src);
		documents.loadAll();

		const created = vi.fn();
		bus.on("document:created", created);

		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "duplicate", doc: "orig", name: "copy" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const clone = documents.resolve("copy");
		expect(clone?.pages).toHaveLength(2);
		expect(clone?.meta.charte).toBe("brand");
		if (clone) clone.pages[0]!.name = "mutated";
		expect(documents.resolve("orig")?.pages[0]?.name).toBe("P1");
		expect(created).toHaveBeenCalledWith({ docName: "copy" });
		expect(store.loadOne("copy")?.name).toBe("copy");
		store.close();
	});

	it("errors when the source is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "duplicate", doc: "ghost", name: "copy" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the target name already exists", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "duplicate", doc: "a", name: "b" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=state", () => {
	it("describes format, pages, charte", async () => {
		const { store, bus, documents } = fixture();
		const d = makeDoc("d", 2);
		d.meta.charte = "brand";
		store.saveDoc(d);
		documents.loadAll();

		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "state", doc: "d" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/Document: "d"/);
		expect(txt).toMatch(/Charte: brand/);
		expect(txt).toMatch(/Pages \(2\)/);
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "state", doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=meta", () => {
	it("errors when the document does not exist", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler({ action: "meta", doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("updates in-memory meta fields and emits meta:updated", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("poster"));
		documents.loadAll();

		const listener = vi.fn();
		bus.on("meta:updated", listener);

		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{
				action: "meta",
				doc: "poster",
				designNotes: "bold hero",
				rating: 4,
				category: "affiche",
				charte: "primary",
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const reloaded = documents.resolve("poster");
		expect(reloaded?.meta.designNotes).toBe("bold hero");
		expect(reloaded?.meta.rating).toBe(4);
		expect(reloaded?.category).toBe("affiche");
		expect(reloaded?.meta.charte).toBe("primary");
		expect(listener).toHaveBeenCalledWith({ docName: "poster" });
		store.close();
	});

	it("clamps rating into [0, 5]", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("clamp"));
		documents.loadAll();
		const tool = createMaketDocTool({ bus, documents });
		await tool.handler({ action: "meta", doc: "clamp", rating: 99 }, NO_EXTRA);
		expect(documents.resolve("clamp")?.meta.rating).toBe(5);
		await tool.handler({ action: "meta", doc: "clamp", rating: -3 }, NO_EXTRA);
		expect(documents.resolve("clamp")?.meta.rating).toBe(0);
		store.close();
	});
});

describe("maket_doc — action=rename", () => {
	it("renames a document in memory and store", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("old"));
		store.saveDoc(makeDoc("other"));
		documents.loadAll();

		const loaded = vi.fn();
		bus.on("document:loaded", loaded);

		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "rename", doc: "old", name: "new" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(documents.resolve("old")).toBeNull();
		expect(documents.resolve("new")?.name).toBe("new");
		expect(store.loadOne("old")).toBeNull();
		expect(store.loadOne("new")?.name).toBe("new");
		expect(loaded).toHaveBeenCalledWith({ docName: "new" });
		store.close();
	});

	it("errors when the source is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "rename", doc: "ghost", name: "x" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the target name already exists", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({ bus, documents });
		const res = await tool.handler(
			{ action: "rename", doc: "a", name: "b" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});
