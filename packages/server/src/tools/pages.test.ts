import { describe, expect, it, vi } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketPageTool, pagesPack } from "./pages.js";

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	return { store, bus, documents };
}

const NO_EXTRA = {} as any;

function makeDoc(name: string, pageCount = 1) {
	const pages = Array.from({ length: pageCount }, (_, i) => ({
		name: `P${i + 1}`,
		elements: [],
	}));
	return createDocument({
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

describe("pagesPack — registration", () => {
	it("declares id and deps", () => {
		expect(pagesPack.id).toBe("pages");
		expect(pagesPack.requires).toEqual(
			expect.arrayContaining(["documents", "bus"]),
		);
	});
});

describe("maket_page — action=add", () => {
	it("appends a page and sets it active", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const listener = vi.fn();
		bus.on("document:loaded", listener);

		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{
				action: "add",
				doc: "d",
				name: "Second",
				html: `<div data-id="p2">Hi</div>`,
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const d = documents.resolve("d");
		expect(d?.pages).toHaveLength(2);
		expect(d?.pages[1]?.name).toBe("Second");
		expect(d?.activePage).toBe(1);
		expect(listener).toHaveBeenCalledWith({ docName: "d" });
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{ action: "add", doc: "ghost", name: "x", html: "<p></p>" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when required args are missing", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler({ action: "add", doc: "d" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("normalizes relative image src paths to /assets/...", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketPageTool({ bus, documents });
		await tool.handler(
			{
				action: "add",
				doc: "d",
				name: "img",
				html: `<img data-id="pic" src="logo.png">`,
			},
			NO_EXTRA,
		);
		const added = documents.resolve("d")?.pages[1];
		expect(added?.html).toMatch(/src="\/assets\/logo\.png"/);
		store.close();
	});

	it("rejects an invalid state template and restores memory and DB", async () => {
		const { store, bus, documents } = fixture();
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
		documents.loadAll();
		const tool = createMaketPageTool({ bus, documents });

		const result = await tool.handler(
			{
				action: "add",
				doc: "living",
				name: "Unsafe",
				html: '<p data-id="bad">{{ page.number }}</p>',
			},
			NO_EXTRA,
		);

		expect(result.isError).toBe(true);
		expect(documents.resolve("living")?.pages).toHaveLength(1);
		expect(store.loadOne("living")?.pages).toHaveLength(1);
		store.close();
	});
});

describe("maket_page — action=remove", () => {
	it("refuses to remove the last page", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d", 1));
		documents.loadAll();
		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{ action: "remove", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("removes a page by 1-based index and clamps activePage", async () => {
		const { store, bus, documents } = fixture();
		const d = makeDoc("d", 3);
		d.activePage = 2;
		store.saveDoc(d);
		documents.loadAll();

		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{ action: "remove", doc: "d", page: 3 },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const doc = documents.resolve("d");
		expect(doc?.pages).toHaveLength(2);
		expect(doc?.activePage).toBe(1);
		store.close();
	});

	it("errors for an out-of-range page", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d", 2));
		documents.loadAll();
		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{ action: "remove", doc: "d", page: 99 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_page — action=rename", () => {
	it("renames by 1-based index", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d", 2));
		documents.loadAll();
		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{ action: "rename", doc: "d", page: 2, name: "Cover" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(documents.resolve("d")?.pages[1]?.name).toBe("Cover");
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{ action: "rename", doc: "ghost", page: 1, name: "x" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_page — action=reorder", () => {
	it("moves a page and adjusts activePage when the moved page was active", async () => {
		const { store, bus, documents } = fixture();
		const d = makeDoc("d", 3);
		d.activePage = 0;
		store.saveDoc(d);
		documents.loadAll();

		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{ action: "reorder", doc: "d", from: 1, to: 3 },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const doc = documents.resolve("d");
		expect(doc?.pages[2]?.name).toBe("P1");
		expect(doc?.activePage).toBe(2);
		store.close();
	});

	it("errors when from is out of range", async () => {
		const { store, bus, documents } = fixture();
		store.saveDoc(makeDoc("d", 2));
		documents.loadAll();
		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler(
			{ action: "reorder", doc: "d", from: 99, to: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_page — action=list", () => {
	it("returns a numbered summary with a marker on the active page", async () => {
		const { store, bus, documents } = fixture();
		const d = makeDoc("d", 3);
		d.activePage = 1;
		store.saveDoc(d);
		documents.loadAll();

		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler({ action: "list", doc: "d" }, NO_EXTRA);
		const text = (res.content[0] as any).text as string;
		expect(text).toMatch(/3 pages:/);
		expect(text).toMatch(/2\. P2 \(0 elements\) ●/);
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents } = fixture();
		const tool = createMaketPageTool({ bus, documents });
		const res = await tool.handler({ action: "list", doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});
