import { describe, expect, it, vi } from "vitest";
import { createBus } from "../services/bus.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketMermaidTool, mermaidPack } from "./mermaid.js";

/**
 * Build a fresh test fixture: in-memory store, documents service hydrated
 * with one doc that has a single empty page.
 */
function fixture() {
	const store = createSQLiteStore(":memory:");
	const doc = createDocument({
		name: "test",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
	});
	store.saveDoc(doc);
	const documents = createDocuments({ store });
	documents.loadAll();
	const bus = createBus();
	return { store, documents, bus, doc };
}

describe("createMaketMermaidTool — metadata", () => {
	it("declares name and schema shape", () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });
		expect(tool.metadata.name).toBe("maket_mermaid");
		expect(tool.metadata.description).toMatch(/Mermaid/);
		expect(tool.metadata.schema.shape).toHaveProperty("doc");
		expect(tool.metadata.schema.shape).toHaveProperty("page");
		expect(tool.metadata.schema.shape).toHaveProperty("code");
	});
});

describe("createMaketMermaidTool — happy path", () => {
	it("renders a simple flowchart and injects an SVG into the page", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		const res = await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);

		expect(res.isError).toBeUndefined();
		expect(documents.resolve("test")?.pages[0]?.html ?? "").toMatch(/<svg/);
		// biome-ignore lint/suspicious/noExplicitAny: runtime payload shape
		const firstItem = (res.content as any[])[0];
		expect(firstItem?.text).toMatch(/Mermaid diagram injected/);
	});

	it("auto-generates sequential dataIds (mermaid-1, mermaid-2, ...)", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);
		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  C-->D" },
			{} as any,
		);

		const html = documents.resolve("test")?.pages[0]?.html ?? "";
		expect(html).toMatch(/data-id="mermaid-1"/);
		expect(html).toMatch(/data-id="mermaid-2"/);
	});

	it("replaces an existing diagram when the dataId already exists", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B", dataId: "diag" },
			{} as any,
		);
		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  X-->Y", dataId: "diag" },
			{} as any,
		);

		const html = documents.resolve("test")?.pages[0]?.html ?? "";
		// Only one instance of that dataId
		expect(html.match(/data-id="diag"/g)?.length).toBe(1);
	});

	it("persists the document to the store after injection", async () => {
		const { documents, bus, store } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);

		const reloaded = store.loadOne("test");
		expect(reloaded?.pages[0]?.html ?? "").toMatch(/<svg/);
	});

	it("only surfaces page-level data-ids, not SVG internals", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		const res = await tool.handler(
			{
				doc: "test",
				page: 1,
				code: "graph TD\n  Alpha-->Beta\n  Beta-->Gamma",
				dataId: "diag",
			},
			{} as any,
		);

		// biome-ignore lint/suspicious/noExplicitAny: runtime payload shape
		const out = (res.content as any[])[0]?.text as string;
		expect(out).toMatch(/page data-ids/);
		// Only the top-level wrapper id should appear — not "Alpha", "Beta" etc
		// which mermaid injects as data-id attributes inside the SVG.
		expect(out).toMatch(/diag/);
		expect(out).not.toMatch(/Alpha/);
		expect(out).not.toMatch(/Beta/);
	});

	it("emits element:updated on the bus", async () => {
		const { documents, bus } = fixture();
		const listener = vi.fn();
		bus.on("element:updated", listener);

		const tool = createMaketMermaidTool({ documents, bus });
		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ docName: "test" }),
		);
	});
});

describe("createMaketMermaidTool — error paths", () => {
	it("returns an error when the document is missing", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		const res = await tool.handler(
			{ doc: "ghost", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);

		expect(res.isError).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: runtime payload shape
		const firstItem = (res.content as any[])[0];
		expect(firstItem?.text).toMatch(/not found/i);
	});

	it("returns an error when the page index is out of range", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		const res = await tool.handler(
			{ doc: "test", page: 99, code: "graph TD\n  A-->B" },
			{} as any,
		);

		expect(res.isError).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: runtime payload shape
		const firstItem = (res.content as any[])[0];
		expect(firstItem?.text).toMatch(/Page 99 not found/);
	});

	it("returns an error when the Mermaid code is malformed", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
		const res = await tool.handler(
			{ doc: "test", page: 1, code: "this is not mermaid syntax at all" },
			{} as any,
		);

		expect(res.isError).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: runtime payload shape
		const firstItem = (res.content as any[])[0];
		expect(firstItem?.text).toMatch(/Mermaid render failed/);
	});
});

describe("mermaidPack — registration", () => {
	it("declares its dependencies", () => {
		expect(mermaidPack.id).toBe("mermaid");
		expect(mermaidPack.requires).toEqual(
			expect.arrayContaining(["documents", "bus"]),
		);
	});
});
