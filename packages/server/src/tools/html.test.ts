import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { createAssetsService } from "../services/assets.js";
import { createDocuments } from "../services/documents.js";
import type { LayoutResult, LayoutService } from "../services/layout.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketHtmlTool, htmlPack } from "./html.js";

const OK_RESULT: LayoutResult = {
	status: "ok",
	text: "\n✓ Layout OK",
	overflowIds: [],
	overlapIds: [],
};

function fakeLayout(result: LayoutResult = OK_RESULT): LayoutService & {
	measure: ReturnType<typeof vi.fn>;
	check: ReturnType<typeof vi.fn>;
} {
	return {
		measure: vi.fn(async () => result),
		check: vi.fn(async () => result),
	} as unknown as LayoutService & {
		measure: ReturnType<typeof vi.fn>;
		check: ReturnType<typeof vi.fn>;
	};
}

function fixture(layoutResult: LayoutResult = OK_RESULT) {
	const tmp = mkdtempSync(join(tmpdir(), "maket-html-"));
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const assets = createAssetsService({ assetsDir: tmp });
	const layout = fakeLayout(layoutResult);
	return {
		store,
		documents,
		layout,
		assets,
		cleanupAssets: () => rmSync(tmp, { recursive: true, force: true }),
	};
}

const NO_EXTRA = {} as any;

function makeDoc(name: string, html = "", meta: Record<string, unknown> = {}) {
	return createDocument({
		name,
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		meta,
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

	it("rejects layout-ignore overrides in a full set", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">original</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "set",
				doc: "d",
				page: 1,
				html: `<div data-id="a" data-maket-layout="ignore">replacement</div>`,
			},
			NO_EXTRA,
		);

		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toContain(
			`maket_html action=patch using attr`,
		);
		expect(documents.resolve("d")?.pages[0]?.html).toContain("original");
		expect(layout.measure).not.toHaveBeenCalled();
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

	it("rejects an invalid state template before changing the page", async () => {
		const { store, documents, layout, assets } = fixture();
		const doc = makeDoc("living", '<div data-id="a">{{ state.title }}</div>');
		store.saveDoc(doc);
		store.initializeDocumentState(
			doc.id,
			{
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			{ title: "Original" },
		);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const result = await tool.handler(
			{
				action: "set",
				doc: "living",
				page: 1,
				html: '<div data-id="a">{{ page.number }}</div>',
			},
			NO_EXTRA,
		);

		expect(result.isError).toBe(true);
		expect(documents.resolve("living")?.pages[0]?.html).toContain(
			"{{ state.title }}",
		);
		expect(store.loadOne("living")?.pages[0]?.html).toContain(
			"{{ state.title }}",
		);
		store.close();
	});

	it("rejects an incompatible state control before changing the page", async () => {
		const { store, documents, layout, assets } = fixture();
		const doc = makeDoc("living", '<div data-id="a">{{ state.title }}</div>');
		store.saveDoc(doc);
		store.initializeDocumentState(
			doc.id,
			{
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			{ title: "Original" },
		);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const result = await tool.handler(
			{
				action: "set",
				doc: "living",
				page: 1,
				html: '<label data-id="a"><input type="checkbox" data-maket-bind="state.title">Title</label>',
			},
			NO_EXTRA,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining("requires a boolean"),
		});
		expect(store.loadOne("living")?.pages[0]?.html).toContain(
			"{{ state.title }}",
		);
		store.close();
	});

	it("rejects an incomplete state select before changing the page", async () => {
		const { store, documents, layout, assets } = fixture();
		const doc = makeDoc("living", '<div data-id="a">{{ state.status }}</div>');
		store.saveDoc(doc);
		store.initializeDocumentState(
			doc.id,
			{
				type: "object",
				properties: {
					status: { type: "string", enum: ["todo", "done"] },
				},
				required: ["status"],
			},
			{ status: "todo" },
		);
		doc.dataModel = "state";
		store.saveDoc(doc);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const result = await tool.handler(
			{
				action: "set",
				doc: "living",
				page: 1,
				html: '<select data-id="a" data-maket-bind="state.status"><option value="todo">À faire</option></select>',
			},
			NO_EXTRA,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining("exactly one selectable option"),
		});
		expect(store.loadOne("living")?.pages[0]?.html).toContain(
			"{{ state.status }}",
		);
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

	it("rejects writes on locked documents", async () => {
		const { store, documents, layout, assets, cleanupAssets } = fixture();
		store.saveDoc(makeDoc("d", "", { locked: true }));
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "set",
				doc: "d",
				page: 1,
				html: `<div data-id="a">x</div>`,
			},
			NO_EXTRA,
		);

		expect(res.isError).toBe(true);
		expect(layout.measure).not.toHaveBeenCalled();
		cleanupAssets();
		store.close();
	});

	it("requires a current charte context token when the document has a charte", async () => {
		const { store, documents, layout, assets, cleanupAssets } = fixture();
		store.saveCharte({
			name: "brand",
			tokens: { color: { primary: "#2563EB" } },
		});
		store.saveDoc(makeDoc("d", "", { charte: "brand" }));
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "set",
				doc: "d",
				page: 1,
				html: `<div data-id="a" style="color:#111111">x</div>`,
			},
			NO_EXTRA,
		);

		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/token/i);
		cleanupAssets();
		store.close();
	});

	it("rejects charte violations even with a valid context token", async () => {
		const { store, documents, layout, assets, cleanupAssets } = fixture();
		store.saveCharte({
			name: "brand",
			tokens: { color: { primary: "#2563EB" } },
		});
		store.saveDoc(makeDoc("d", "", { charte: "brand" }));
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "set",
				doc: "d",
				page: 1,
				html: `<div data-id="a" style="color:#2563EB">x</div>`,
				context_token: assets.charteToken(store.loadCharte("brand")),
			},
			NO_EXTRA,
		);

		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/Charte violation/);
		expect(documents.resolve("d")?.pages[0]?.html).toBeUndefined();
		expect(layout.measure).not.toHaveBeenCalled();
		cleanupAssets();
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

	it("adds layout-ignore surgically through an attr patch", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="scrim"></div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					{
						id: "scrim",
						attr: { "data-maket-layout": "ignore" },
					},
				],
			},
			NO_EXTRA,
		);

		expect(res.isError).toBeUndefined();
		expect(documents.resolve("d")?.pages[0]?.html).toContain(
			'data-maket-layout="ignore"',
		);
		expect(layout.measure).toHaveBeenCalledOnce();
		store.close();
	});

	it("rejects layout-ignore embedded in patch HTML", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">original</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					{
						id: "a",
						replace:
							'<div data-id="a" data-maket-layout="ignore">replacement</div>',
					},
				],
			},
			NO_EXTRA,
		);

		expect(res.isError).toBeUndefined();
		expect((res.content[0] as any).text).toContain("rejected");
		expect((res.content[0] as any).text).toContain("using attr");
		expect(documents.resolve("d")?.pages[0]?.html).toContain("original");
		store.close();
	});

	it.each(["insert", "content"] as const)(
		"rejects layout-ignore embedded in patch %s HTML",
		async (field) => {
			const { store, documents, layout, assets } = fixture();
			store.saveDoc(makeDoc("d", `<div data-id="a">original</div>`));
			documents.loadAll();
			const tool = createMaketHtmlTool({ documents, store, layout, assets });

			const res = await tool.handler(
				{
					action: "patch",
					doc: "d",
					page: 1,
					ops: [
						{
							id: "a",
							[field]:
								'<span data-id="decoration" data-maket-layout="ignore"></span>',
						},
					],
				},
				NO_EXTRA,
			);

			expect((res.content[0] as any).text).toContain("rejected");
			expect(documents.resolve("d")?.pages[0]?.html).toContain("original");
			store.close();
		},
	);

	it("rejects an enabling op mixed with style or other attributes", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">original</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					{
						id: "a",
						attr: {
							"data-maket-layout": "ignore",
							role: "presentation",
						},
						style: { position: "absolute" },
					},
				],
			},
			NO_EXTRA,
		);

		expect((res.content[0] as any).text).toContain(
			"must contain only id and that single attr",
		);
		expect(documents.resolve("d")?.pages[0]?.html).not.toContain(
			"data-maket-layout",
		);
		store.close();
	});

	it.each([
		{
			kind: "text",
			html: `<div data-id="a">visible content</div>`,
		},
		{
			kind: "child element",
			html: `<div data-id="a"><span data-id="child"></span></div>`,
		},
	])("rejects layout-ignore on a block containing $kind", async ({ html }) => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", html));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					{
						id: "a",
						attr: { "data-maket-layout": "ignore" },
					},
				],
			},
			NO_EXTRA,
		);

		expect((res.content[0] as any).text).toContain(
			"only on a non-interactive leaf decoration",
		);
		expect(documents.resolve("d")?.pages[0]?.html).not.toContain(
			"data-maket-layout",
		);
		expect(layout.measure).toHaveBeenCalledOnce();
		store.close();
	});

	it.each([
		{ kind: "native input", html: `<input data-id="a">` },
		{
			kind: "state-bound element",
			html: `<div data-id="a" data-maket-bind="state.done"></div>`,
		},
		{
			kind: "focusable element",
			html: `<div data-id="a" tabindex="0"></div>`,
		},
	])("rejects layout-ignore on a $kind", async ({ html }) => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", html));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					{
						id: "a",
						attr: { "data-maket-layout": "ignore" },
					},
				],
			},
			NO_EXTRA,
		);

		expect((res.content[0] as any).text).toContain(
			"only on a non-interactive leaf decoration",
		);
		expect(documents.resolve("d")?.pages[0]?.html).not.toContain(
			"data-maket-layout",
		);
		store.close();
	});

	it("rejects making an ignored decoration interactive later", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(
			makeDoc("d", `<div data-id="a" data-maket-layout="ignore"></div>`),
		);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [{ id: "a", attr: { tabindex: "0" } }],
			},
			NO_EXTRA,
		);

		expect((res.content[0] as any).text).toContain(
			"Interactive attributes cannot be added",
		);
		expect(documents.resolve("d")?.pages[0]?.html).not.toContain("tabindex");
		store.close();
	});

	it("strips layout-ignore from cloned blocks and descendants", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(
			makeDoc(
				"d",
				`<div data-id="a" data-maket-layout="ignore"><span data-id="child" data-maket-layout="ignore"></span></div>`,
			),
		);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [{ id: "a", clone: "copy" }],
			},
			NO_EXTRA,
		);

		const html = documents.resolve("d")?.pages[0]?.html ?? "";
		const { document } = parseHTML(`<html><body>${html}</body></html>`);
		const clone = document.body.querySelector('[data-id="copy"]');
		expect(clone?.hasAttribute("data-maket-layout")).toBe(false);
		expect(clone?.querySelector("[data-maket-layout]")).toBeNull();
		store.close();
	});

	it("rejects content changes inside an already ignored block", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(
			makeDoc(
				"d",
				`<div data-id="a" data-maket-layout="ignore">decoration</div>`,
			),
		);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [{ id: "a", content: "important content" }],
			},
			NO_EXTRA,
		);

		expect((res.content[0] as any).text).toContain("Content cannot be changed");
		expect(documents.resolve("d")?.pages[0]?.html).toContain("decoration");
		store.close();
	});

	it.each([
		{
			kind: "insert",
			first: {
				id: "a",
				position: "afterend" as const,
				insert: '<div data-id="fresh"></div>',
			},
		},
		{
			kind: "replace",
			first: { id: "a", replace: '<div data-id="fresh"></div>' },
		},
		{
			kind: "content",
			first: { id: "a", content: '<span data-id="fresh"></span>' },
		},
	])("rejects batch $kind then layout-ignore", async ({ first }) => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">original</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					first,
					{
						id: "fresh",
						attr: { "data-maket-layout": "ignore" },
					},
				],
			},
			NO_EXTRA,
		);

		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toContain(
			"only op in the patch request",
		);
		expect(documents.resolve("d")?.pages[0]?.html).toBe(
			`<div data-id="a">original</div>`,
		);
		expect(layout.measure).not.toHaveBeenCalled();
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

	it("rolls back only the violating op when a charte check fails", async () => {
		const { store, documents, layout, assets, cleanupAssets } = fixture();
		store.saveCharte({
			name: "brand",
			tokens: { color: { primary: "#2563EB" } },
		});
		store.saveDoc(
			makeDoc("d", `<div data-id="a">a</div><div data-id="b">b</div>`, {
				charte: "brand",
			}),
		);
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					{ id: "a", style: { color: "#2563EB" } },
					{ id: "b", style: { color: "#00ff00" } },
				],
			},
			NO_EXTRA,
		);

		const html = documents.resolve("d")?.pages[0]?.html ?? "";
		expect(res.isError).toBeUndefined();
		expect((res.content[0] as any).text).toMatch(/a rejected/);
		expect(html).toContain(`data-id="a">a</div>`);
		expect(html).toContain(`data-id="b"`);
		expect(html).toContain(`style="color:#00ff00"`);
		cleanupAssets();
		store.close();
	});

	it("sanitizes inserted active HTML and normalizes relative image sources", async () => {
		const { store, documents, layout, assets, cleanupAssets } = fixture();
		store.saveDoc(makeDoc("d", `<div data-id="a">a</div>`));
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					{
						id: "a",
						position: "afterend",
						insert:
							'<img data-id="img" src="logo.png" onerror="alert(1)"><script>alert(1)</script>',
					},
				],
			},
			NO_EXTRA,
		);

		const html = documents.resolve("d")?.pages[0]?.html ?? "";
		expect(html).toContain('src="/assets/logo.png"');
		expect(html).not.toContain("onerror=");
		expect(html).not.toContain("<script");
		cleanupAssets();
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

describe("maket_html — layout signal → next: hints", () => {
	const TIGHT: LayoutResult = {
		status: "tight",
		text: "\n⚠ Layout tight — bottom margin 4mm (min 15mm). Tighten or move content up before shipping.",
		overflowIds: [],
		overlapIds: [],
	};
	const OVERFLOW: LayoutResult = {
		status: "overflow",
		text: "\n⛔ Layout overflow — not shippable:\n  Vertical: content 400px > container 358px (+42px)\n  Overflowing: footer, p3-footer-left",
		overflowIds: ["footer", "p3-footer-left"],
		overlapIds: [],
	};
	const UNCHECKED: LayoutResult = {
		status: "unchecked",
		text: "\n⛔ Layout check unavailable — not shippable until headless validation runs.",
		overflowIds: [],
		overlapIds: [],
	};

	it("keeps the response clean when layout is ok (no next: block)", async () => {
		const { store, documents, layout, assets } = fixture(OK_RESULT);
		store.saveDoc(makeDoc("d", `<div data-id="x">x</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect((res.content[0] as any).text).not.toMatch(/^next:/m);
		store.close();
	});

	it("appends snapshot + patch hints on tight (no specific ids)", async () => {
		const { store, documents, layout, assets } = fixture(TIGHT);
		store.saveDoc(makeDoc("d", `<div data-id="x">x</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		const body = (res.content[0] as any).text as string;
		expect(body).toMatch(/Layout tight/);
		expect(body).toMatch(/next:/);
		expect(body).toMatch(/maket_preview action=snapshot doc=d page=1/);
		expect(body).toMatch(/maket_html action=patch doc=d page=1/);
		expect(body).toMatch(/reduce paddings\/margins/);
		store.close();
	});

	it("targets overflowing ids in the patch hint on overflow", async () => {
		const { store, documents, layout, assets } = fixture(OVERFLOW);
		store.saveDoc(makeDoc("d", `<div data-id="x">x</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		const body = (res.content[0] as any).text as string;
		expect(body).toMatch(/next:/);
		expect(body).toMatch(/maket_preview action=snapshot doc=d page=1/);
		expect(body).toMatch(
			/maket_html action=patch doc=d page=1.*# target: footer, p3-footer-left/,
		);
		store.close();
	});

	it("keeps unchecked diagnostic-only without a blind retry loop", async () => {
		const { store, documents, layout, assets } = fixture(UNCHECKED);
		store.saveDoc(makeDoc("d", `<div data-id="x">x</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		const body = (res.content[0] as any).text as string;
		expect(body).toMatch(/Layout check unavailable/);
		expect(body).not.toMatch(/next:/);
		expect(body).not.toMatch(/maket_preview/);
		expect(body).not.toMatch(/action=patch/);
		store.close();
	});

	it("wires hints through action=set so agents see them after writing", async () => {
		const { store, documents, layout, assets } = fixture(OVERFLOW);
		store.saveDoc(makeDoc("d"));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "set",
				doc: "d",
				page: 1,
				html: `<div data-id="a">x</div>`,
			},
			NO_EXTRA,
		);
		const body = (res.content[0] as any).text as string;
		expect(body).toMatch(/Layout overflow/);
		expect(body).toMatch(/next:/);
		expect(body).toMatch(/maket_preview action=snapshot doc=d page=1/);
		store.close();
	});

	it("wires hints through action=patch so agents see them after edits", async () => {
		const { store, documents, layout, assets } = fixture(TIGHT);
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
		const body = (res.content[0] as any).text as string;
		expect(body).toMatch(/Layout tight/);
		expect(body).toMatch(/next:/);
		expect(body).toMatch(/maket_preview action=snapshot doc=d page=1/);
		store.close();
	});
});

describe("maket_html — lock guard", () => {
	it("refuses set on a locked document", async () => {
		const { store, documents, layout, assets } = fixture();
		const d = makeDoc("d");
		d.meta.locked = true;
		store.saveDoc(d);
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "set",
				doc: "d",
				page: 1,
				html: `<div data-id="a">x</div>`,
			},
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/locked/i);
		expect(documents.resolve("d")?.pages[0]?.html).toBeFalsy();
		expect(layout.measure).not.toHaveBeenCalled();
		store.close();
	});

	it("refuses patch on a locked document", async () => {
		const { store, documents, layout, assets } = fixture();
		const d = makeDoc("d", `<div data-id="a">x</div>`);
		d.meta.locked = true;
		store.saveDoc(d);
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [{ id: "a", content: "y" }],
			},
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect(documents.resolve("d")?.pages[0]?.html).toBe(
			`<div data-id="a">x</div>`,
		);
		store.close();
	});

	it("still allows read-only actions (get, check) on a locked document", async () => {
		const { store, documents, layout, assets } = fixture();
		const d = makeDoc("d", `<div data-id="a">x</div>`);
		d.meta.locked = true;
		store.saveDoc(d);
		documents.loadAll();

		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const getRes = await tool.handler(
			{ action: "get", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(getRes.isError).toBeUndefined();
		const checkRes = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(checkRes.isError).toBeUndefined();
		store.close();
	});
});
