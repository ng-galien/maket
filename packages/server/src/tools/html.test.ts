import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { createAssetsService } from "../services/assets.js";
import { createBus } from "../services/bus.js";
import { createCollectionCursors } from "../services/collection-cursor.js";
import { createCollectionRenderer } from "../services/collection-renderer.js";
import { createCollections } from "../services/collections.js";
import { createDocumentRenderer } from "../services/document-renderer.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import type { LayoutResult, LayoutService } from "../services/layout.js";
import { createStateRenderer } from "../services/state-renderer.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import {
	createMaketHtmlTool as createMaketHtmlToolFactory,
	type HtmlDeps,
	htmlPack,
} from "./html.js";

/** The tool wired to the real renderers over the test's store and documents. */
function createMaketHtmlTool(
	deps: Omit<HtmlDeps, "documentRenderer" | "collectionCursors"> &
		Partial<Pick<HtmlDeps, "collectionCursors">>,
) {
	const bus = createBus();
	const { documents, store } = deps;
	return createMaketHtmlToolFactory({
		...deps,
		documentRenderer: createDocumentRenderer({
			collectionRenderer: createCollectionRenderer({
				collections: createCollections({ bus, documents, store }),
			}),
			stateRenderer: createStateRenderer({
				documentStates: createDocumentStates({ bus, documents, store }),
			}),
			structuredWorkspaces: {
				renderCollection: () => {
					throw new Error("No Structured Workspace in this test");
				},
			},
		}),
		collectionCursors:
			deps.collectionCursors ??
			createCollectionCursors({ bus, documents, store }),
	});
}

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

	it("rejects writes to a Structured Workspace template-controlled page", async () => {
		const { store, documents, layout, assets } = fixture();
		const doc = makeDoc("instance", '<p data-id="title">Original</p>');
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.provenance = {
			kind: "template",
			workspaceId: "workspace-1",
			templateDocumentId: "template-1",
			templatePageId: "template-page-1",
		};
		store.saveDoc(doc);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });

		const result = await tool.handler(
			{
				action: "set",
				doc: "instance",
				page: 1,
				html: '<p data-id="title">Changed</p>',
			},
			NO_EXTRA,
		);

		expect(result.isError).toBe(true);
		expect(documents.resolve("instance")?.pages[0]?.html).toContain("Original");
		expect(layout.measure).not.toHaveBeenCalled();
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

describe("maket_html — state values in presentation attributes", () => {
	function stateFixture() {
		const context = fixture();
		const doc = makeDoc("bars", '<div data-id="a">{{ state.label }}</div>');
		context.store.saveDoc(doc);
		context.store.initializeDocumentState(
			doc.id,
			{
				type: "object",
				properties: {
					value: { type: ["number", "string"] },
					label: { type: "string" },
				},
				required: ["value", "label"],
			},
			{ value: 40, label: "Load" },
		);
		context.documents.loadAll();
		const tool = createMaketHtmlTool({
			documents: context.documents,
			store: context.store,
			layout: context.layout,
			assets: context.assets,
		});
		const set = (html: string) =>
			tool.handler({ action: "set", doc: "bars", page: 1, html }, NO_EXTRA);
		return { ...context, set };
	}

	it("persists an SVG bar whose width is a state value", async () => {
		const { store, set } = stateFixture();
		const result = await set(
			'<svg data-id="chart" viewBox="0 0 100 10"><rect data-id="bar" height="10" width="{{ state.value }}" style="transition: width 300ms"></rect></svg>',
		);
		expect(result.isError).toBeUndefined();
		expect(store.loadOne("bars")?.pages[0]?.html).toContain(
			'width="{{ state.value }}"',
		);
		expect(store.loadOne("bars")?.pages[0]?.html).toContain("viewBox=");
		store.close();
	});

	it.each([
		[
			"an attribute outside the whitelist",
			'<svg data-id="chart"><rect data-id="bar" fill="{{ state.value }}"></rect></svg>',
			"cannot be placed in <rect fill>",
		],
		[
			"a style property outside the whitelist",
			'<div data-id="bar" style="color: {{ state.value }}"></div>',
			"cannot set <div style color>",
		],
		[
			"an active construct",
			'<div data-id="bar" style="width: {{ state.value }}px; background: url(https://example.test/x.png)"></div>',
			"active construct",
		],
		[
			"a value that does not render a number",
			'<svg data-id="chart"><rect data-id="bar" width="{{ state.label }}"></rect></svg>',
			'<rect width> must render a number or a length (number with px, %, em, rem, mm, cm, in, pt…); got "Load"',
		],
	])("refuses %s before changing the page", async (_case, html, message) => {
		const { store, set } = stateFixture();
		const result = await set(html);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining(message),
		});
		expect(store.loadOne("bars")?.pages[0]?.html).toContain(
			"{{ state.label }}",
		);
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
		const report = [
			"\n⛔ Layout overflow — not shippable:",
			"  Overflowing: diagram",
			"",
			"### Measurements",
			"- Physical canvas: 210×297mm (794×1123px)",
			"| Element | Problem | Measured box | Excess |",
			"| --- | --- | --- | --- |",
			"| `[diagram]` | physical canvas | x=53, y=48, w=688, h=1095px | canvas: bottom +20px |",
		].join("\n");
		const { store, documents, layout, assets } = fixture({
			status: "overflow",
			text: report,
			overflowIds: ["diagram"],
			overlapIds: [],
		});
		store.saveDoc(makeDoc("d", `<div data-id="x">x</div>`));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(
			(res.content[0] as any).text.startsWith(
				`Measured the authored HTML: the page has no document state or collection.\n${report.trim()}`,
			),
		).toBe(true);
		expect((res.content[0] as any).text).toContain("canvas: bottom +20px");
		expect(layout.check).toHaveBeenCalled();
		store.close();
	});

	it("reports page links to a missing page", async () => {
		const { store, documents, layout, assets } = fixture();
		const doc = makeDoc(
			"d",
			'<nav data-id="nav"><a data-id="to-p1" href="#page=1">P1</a><a data-id="to-summary" href="#page:Summary">Summary</a><a data-id="to-p4" href="#page=4">P4</a><a href="#page:Missing">x</a><a data-id="to-n" href="#page={{n}}">n</a></nav>',
		);
		doc.pages.push({ id: "summary", name: "Summary", elements: [], html: "" });
		store.saveDoc(doc);
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const res = await tool.handler(
			{ action: "check", doc: "d", page: 1 },
			NO_EXTRA,
		);
		const output = (res.content[0] as any).text as string;
		expect(res.isError).toBeUndefined();
		expect(output).toContain(
			"⛔ page links: 3 link(s) target no page of this document (document has 2 page(s))",
		);
		expect(output).toContain(
			'`#page={{n}}` on data-id="to-n" (Mustache is not accepted in a page link)',
		);
		expect(output).toContain('`#page=4` on data-id="to-p4"');
		expect(output).toContain('`#page:Missing` on data-id="nav"');
		expect(output).not.toContain("`#page=1`");
		expect(output).not.toContain("`#page:Summary`");
		expect(output).toContain("fix page links: to-p4, nav, to-n");
		store.close();
	});

	it("refuses Mustache in a page link on set and patch", async () => {
		const { store, documents, layout, assets } = fixture();
		store.saveDoc(makeDoc("d", '<div data-id="root">x</div>'));
		documents.loadAll();
		const tool = createMaketHtmlTool({ documents, store, layout, assets });
		const set = await tool.handler(
			{
				action: "set",
				doc: "d",
				page: 1,
				html: '<a data-id="next" href="#page={{ state.next }}">Next</a>',
			},
			NO_EXTRA,
		);
		expect(set.isError).toBe(true);
		expect((set.content[0] as any).text).toContain(
			'Mustache is not accepted in a page link:\n- `#page={{ state.next }}` on data-id="next"',
		);
		const patch = await tool.handler(
			{
				action: "patch",
				doc: "d",
				page: 1,
				ops: [
					{
						id: "root",
						insert: '<a data-id="by-name" href="#page:{{name}}">n</a>',
					},
				],
			},
			NO_EXTRA,
		);
		expect(patch.isError).toBe(true);
		expect(documents.resolve("d")?.pages[0]?.html).toBe(
			'<div data-id="root">x</div>',
		);
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

describe("maket_html — measures the page as readers see it", () => {
	function checkFixture() {
		const context = fixture();
		const collectionCursors = createCollectionCursors({
			bus: createBus(),
			documents: context.documents,
			store: context.store,
		});
		const tool = createMaketHtmlTool({
			documents: context.documents,
			store: context.store,
			layout: context.layout,
			assets: context.assets,
			collectionCursors,
		});
		const check = async (doc: string) => {
			const result = await tool.handler(
				{ action: "check", doc, page: 1 },
				NO_EXTRA,
			);
			const body =
				result.content[0]?.type === "text" ? result.content[0].text : "";
			return { result, body };
		};
		return { ...context, tool, check, collectionCursors };
	}

	it("checks a state-backed page hydrated with the current state", async () => {
		const { store, documents, layout, check } = checkFixture();
		store.saveDoc(
			makeDoc("graph", '<div data-id="title">{{ state.title }}</div>'),
		);
		documents.loadAll();
		createDocumentStates({ bus: createBus(), documents, store }).initialize(
			"graph",
			{
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			{ title: "Decisions" },
		);

		const { body } = await check("graph");

		const measured = layout.check.mock.calls[0]?.[1] as string;
		expect(measured).toContain(">Decisions</div>");
		expect(measured).not.toContain("{{");
		expect(body.split("\n")[0]).toBe(
			"Measured with document state revision 1.",
		);
		store.close();
	});

	it("checks a collection page with the member shown by its preview cursor", async () => {
		const { store, documents, layout, check, collectionCursors } =
			checkFixture();
		store.saveCollection({
			name: "clients",
			schema: {
				type: "object",
				properties: { client: { type: "string" } },
				required: ["client"],
			},
			members: [
				{ id: "member_1", position: 0, data: { client: "Helios" } },
				{ id: "member_2", position: 1, data: { client: "Acme" } },
			],
		});
		store.saveDoc(
			createDocument({
				name: "merge",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [
					{
						id: "offer",
						name: "Offer",
						elements: [],
						collection: { name: "clients" },
						html: '<div data-id="client">{{client}}</div>',
					},
				],
			}),
		);
		documents.loadAll();

		await check("merge");
		expect(layout.check.mock.calls[0]?.[1]).toBe(
			'<div data-id="client">Helios</div>',
		);

		collectionCursors.set("merge", 0, { memberId: "member_2" });
		const { body } = await check("merge");
		expect(layout.check.mock.calls[1]?.[1]).toBe(
			'<div data-id="client">Acme</div>',
		);
		expect(body.split("\n")[0]).toBe(
			'Measured with collection "clients" member "member_2".',
		);
		store.close();
	});

	it("checks a collection page without breaking on another page's rendering", async () => {
		const { store, documents, layout, check } = checkFixture();
		store.saveCollection({
			name: "clients",
			schema: {
				type: "object",
				properties: { client: { type: "string" } },
				required: ["client"],
			},
			members: [{ id: "member_1", position: 0, data: { client: "Helios" } }],
		});
		store.saveDoc(
			createDocument({
				name: "mixed",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [
					{
						id: "offer",
						name: "Offer",
						elements: [],
						collection: { name: "clients" },
						html: '<div data-id="client">{{client}}</div>',
					},
					{
						id: "broken",
						name: "Broken",
						elements: [],
						collection: { name: "clients" },
						html: '<div data-id="missing">{{unknown_field}}</div>',
					},
				],
			}),
		);
		documents.loadAll();

		const { body } = await check("mixed");

		expect(layout.check.mock.calls[0]?.[1]).toBe(
			'<div data-id="client">Helios</div>',
		);
		expect(body.split("\n")[0]).toBe(
			'Measured with collection "clients" member "member_1".',
		);
		store.close();
	});

	it("checks a JSON Forms page of a state document on its rendered form", async () => {
		const { store, documents, layout, check } = checkFixture();
		const doc = makeDoc("form");
		const page = doc.pages[0];
		if (!page) throw new Error("Expected a page");
		page.html = undefined;
		page.jsonForms = {};
		store.saveDoc(doc);
		documents.loadAll();
		createDocumentStates({ bus: createBus(), documents, store }).initialize(
			"form",
			{
				type: "object",
				properties: { owner: { type: "string", title: "Owner" } },
				required: ["owner"],
			},
			{ owner: "Camille" },
		);

		const { result, body } = await check("form");

		expect(result.isError).toBeUndefined();
		const measured = layout.check.mock.calls[0]?.[1] as string;
		expect(measured).toContain("Owner");
		expect(measured).toContain('value="Camille"');
		expect(body.split("\n")[0]).toBe(
			"Measured with document state revision 1, JSON Forms rendered.",
		);
		store.close();
	});

	it("checks a Structured Workspace collection document with its items and names them first", async () => {
		const { store, documents, layout, assets } = checkFixture();
		const doc = makeDoc(
			"Delivery — Backlog",
			'<main data-id="page"><section data-maket-structured-items="task"></section></main>',
			{
				structuredWorkspace: {
					role: "collection",
					workspaceId: "ws-1",
					collectionId: "backlog",
				},
			},
		);
		store.saveDoc(doc);
		documents.loadAll();
		const pageId = doc.pages[0]?.id ?? "";
		const renderCollection = vi.fn(() => ({
			...doc,
			pages: [
				{
					id: pageId,
					name: "P1",
					elements: [],
					html: '<main data-id="page"><article>Ship</article></main>',
					flow: { sourcePageId: pageId, index: 0, count: 2 },
				},
				{
					id: `${pageId}~2`,
					name: "P1 (2)",
					elements: [],
					html: '<main data-id="page"><article>Review</article></main>',
					flow: { sourcePageId: pageId, index: 1, count: 2 },
				},
			],
		}));
		const bus = createBus();
		const tool = createMaketHtmlToolFactory({
			documents,
			store,
			layout,
			assets,
			documentRenderer: createDocumentRenderer({
				collectionRenderer: createCollectionRenderer({
					collections: createCollections({ bus, documents, store }),
				}),
				stateRenderer: createStateRenderer({
					documentStates: createDocumentStates({ bus, documents, store }),
				}),
				structuredWorkspaces: { renderCollection },
			}),
			collectionCursors: createCollectionCursors({ bus, documents, store }),
		});

		const result = await tool.handler(
			{ action: "check", doc: "Delivery — Backlog", page: 1 },
			NO_EXTRA,
		);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(renderCollection).toHaveBeenCalledWith("ws-1", "backlog");
		expect(layout.check.mock.calls.map((call) => call[1])).toEqual([
			'<main data-id="page"><article>Ship</article></main>',
			'<main data-id="page"><article>Review</article></main>',
		]);
		expect(body.split("\n")[0]).toBe(
			'Measured with the items of Structured Workspace collection "backlog". A list flows onto 2 pages.',
		);
		expect(body).toContain("Page 2 of 2 (P1 (2)):");
		store.close();
	});

	it("hints at the most severe page of a flowed set, an overflow after a tight page", async () => {
		const { store, documents, layout, assets } = checkFixture();
		const doc = makeDoc(
			"Delivery — Backlog",
			'<main data-id="page"><section data-maket-structured-items="task"></section></main>',
			{
				structuredWorkspace: {
					role: "collection",
					workspaceId: "ws-1",
					collectionId: "backlog",
				},
			},
		);
		store.saveDoc(doc);
		documents.loadAll();
		const pageId = doc.pages[0]?.id ?? "";
		const renderCollection = vi.fn(() => ({
			...doc,
			pages: [
				{
					id: pageId,
					name: "P1",
					elements: [],
					html: '<main data-id="page"><article>Ship</article></main>',
					flow: { sourcePageId: pageId, index: 0, count: 2 },
				},
				{
					id: `${pageId}~2`,
					name: "P1 (2)",
					elements: [],
					html: '<main data-id="page"><article>Review</article></main>',
					flow: { sourcePageId: pageId, index: 1, count: 2 },
				},
			],
		}));
		layout.check
			.mockResolvedValueOnce({
				status: "tight",
				text: "\n⚠ tight",
				overflowIds: [],
				overlapIds: [],
				tightIds: ["margin-block"],
			})
			.mockResolvedValueOnce({
				status: "overflow",
				text: "\n⛔ overflow",
				overflowIds: ["late-block"],
				overlapIds: [],
			});
		const bus = createBus();
		const tool = createMaketHtmlToolFactory({
			documents,
			store,
			layout,
			assets,
			documentRenderer: createDocumentRenderer({
				collectionRenderer: createCollectionRenderer({
					collections: createCollections({ bus, documents, store }),
				}),
				stateRenderer: createStateRenderer({
					documentStates: createDocumentStates({ bus, documents, store }),
				}),
				structuredWorkspaces: { renderCollection },
			}),
			collectionCursors: createCollectionCursors({ bus, documents, store }),
		});

		const result = await tool.handler(
			{ action: "check", doc: "Delivery — Backlog", page: 1 },
			NO_EXTRA,
		);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(body).toContain("⚠ tight");
		expect(body).toContain("⛔ overflow");
		expect(body).toContain("# target: late-block");
		expect(body).not.toContain("# target: margin-block");
		store.close();
	});

	it("keeps checking a page without state or collection as authored", async () => {
		const { store, documents, layout, check } = checkFixture();
		const html = '<div data-id="a">{{ not.state }}</div>';
		store.saveDoc(makeDoc("plain", html));
		documents.loadAll();

		const { body } = await check("plain");

		expect(layout.check).toHaveBeenCalledWith(expect.anything(), html, 0);
		expect(body).toBe(
			"Measured the authored HTML: the page has no document state or collection.\n✓ Layout OK",
		);
		store.close();
	});
});
