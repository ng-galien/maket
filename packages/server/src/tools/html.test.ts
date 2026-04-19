import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAssetsService } from "../services/assets.js";
import { createDocuments } from "../services/documents.js";
import type { LayoutService } from "../services/layout.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketHtmlTool, htmlPack } from "./html.js";

function fakeLayout(): LayoutService & { measure: ReturnType<typeof vi.fn> } {
	return {
		measure: vi.fn(async () => "\n✓ Layout OK"),
		check: vi.fn(async () => "✓ Layout OK"),
	} as LayoutService & { measure: ReturnType<typeof vi.fn> };
}

function fixture() {
	const tmp = mkdtempSync(join(tmpdir(), "maket-html-"));
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const assets = createAssetsService({ assetsDir: tmp });
	const layout = fakeLayout();
	return {
		store,
		documents,
		layout,
		assets,
		cleanupAssets: () => rmSync(tmp, { recursive: true, force: true }),
	};
}

// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
const NO_EXTRA = {} as any;

function makeDoc(name: string, html = "") {
	return createDocument({
		name,
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		pages: [{ name: "P1", elements: [], html }],
	});
}

describe("htmlPack — registration", () => {
	it("declares id and deps", () => {
		expect(htmlPack.id).toBe("html");
		expect(htmlPack.requires).toEqual(
			expect.arrayContaining(["documents", "store", "layout", "assets"]),
		);
	});
});

describe("maket_html — action=set", () => {
	it("replaces page html, normalizes image src and invokes layout.measure", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "set",
				doc: "d",
				page: 1,
				html: `<div data-id="a"><img src="logo.png"></div>`,
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const page = documents.resolve("d")?.pages[0];
		expect(page?.html).toMatch(/src="\/assets\/logo\.png"/);
		expect(layout.measure).toHaveBeenCalledOnce();
		store.close();
	});

	it("errors when doc missing", async () => {
		const { store, documents, layout, assets } = fixture();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "set", doc: "ghost", page: 1, html: "<p></p>" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when page out of range", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "set", doc: "d", page: 99, html: "<p></p>" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when html is missing", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "set", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_html — action=get", () => {
	it("returns the full page html", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="x">body</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "get", doc: "d", page: 1 },
			NO_EXTRA,
		);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const text = (res.content[0] as any).text as string;
		expect(text).toMatch(/<div data-id="x">body<\/div>/);
		store.close();
	});

	it("filters by data-id", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(
			makeDoc("d", `<div data-id="a">A</div><div data-id="b">B</div>`),
		);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "get", doc: "d", page: 1, id: "b" },
			NO_EXTRA,
		);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toBe(`<div data-id="b">B</div>`);
		store.close();
	});

	it("errors for unknown id", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">A</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "get", doc: "d", page: 1, id: "missing" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("extracts text format", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(
			makeDoc("d", `<style>p{color:red}</style><p>Hello <b>world</b></p>`),
		);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "get", doc: "d", page: 1, format: "text" },
			NO_EXTRA,
		);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toBe("Hello world");
		store.close();
	});
});

describe("maket_html — action=patch", () => {
	it("applies a style op and invokes layout.measure", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">x</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [{ id: "a", style: { color: "red" } }],
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(documents.resolve("d")?.pages[0]?.html).toMatch(/style="color:red"/);
		expect(layout.measure).toHaveBeenCalledOnce();
		store.close();
	});

	it("removes an element", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(
			makeDoc("d", `<div data-id="a">a</div><div data-id="b">b</div>`),
		);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [{ id: "a", remove: true }],
			},
			NO_EXTRA,
		);
		expect(documents.resolve("d")?.pages[0]?.html).not.toMatch(/data-id="a"/);
		store.close();
	});

	it("reports not-found for unknown ids without failing", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">a</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [{ id: "ghost", remove: true }],
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/ghost not found/);
		store.close();
	});

	it("errors when ops is missing", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">a</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "patch", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_html — action=check", () => {
	it("delegates to layout.check and returns its text", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="x">x</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/Layout OK/);
		expect(layout.check).toHaveBeenCalled();
		store.close();
	});

	it("errors when the page has no html", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});
