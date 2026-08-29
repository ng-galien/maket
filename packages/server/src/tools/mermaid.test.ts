import { readFileSync } from "node:fs";
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

function attachCharte(
	fixtureResult: ReturnType<typeof fixture>,
	tokens: Record<string, Record<string, string>>,
) {
	fixtureResult.store.saveCharte({ name: "brand", tokens });
	const document = fixtureResult.documents.resolve("test");
	if (document) document.meta.charte = "brand";
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
		expect(tool.metadata.schema.shape).toHaveProperty("tokenRefs");
		expect(tool.metadata.schema.shape).toHaveProperty("muted");
		expect(tool.metadata.schema.shape).toHaveProperty("surface");
		expect(tool.metadata.schema.shape).toHaveProperty("border");
		expect(tool.metadata.schema.shape).toHaveProperty("font");
		expect(tool.metadata.schema.shape).toHaveProperty("transparent");
		expect(tool.metadata.schema.shape).toHaveProperty("padding");
		expect(tool.metadata.schema.shape).toHaveProperty("nodeSpacing");
		expect(tool.metadata.schema.shape).toHaveProperty("layerSpacing");
		expect(tool.metadata.schema.shape).not.toHaveProperty("componentSpacing");
	});

	it("keeps the LHM distribution schema aligned with the executable tool", () => {
		const lhm = JSON.parse(
			readFileSync(
				new URL("../../../../lhm.plugin.json", import.meta.url),
				"utf8",
			),
		) as {
			tools: Array<{
				name: string;
				description: string;
				inputSchema: { properties: Record<string, unknown> };
			}>;
		};
		const distributed = lhm.tools.find(
			(entry) => entry.name === "maket_mermaid",
		);
		expect(distributed?.description).toMatch(/durable inline SVG/);
		expect(distributed?.inputSchema.properties).toEqual(
			expect.objectContaining({
				tokenRefs: expect.any(Object),
				muted: expect.any(Object),
				surface: expect.any(Object),
				border: expect.any(Object),
				font: expect.any(Object),
				transparent: expect.any(Object),
				padding: expect.any(Object),
				nodeSpacing: expect.any(Object),
				layerSpacing: expect.any(Object),
			}),
		);
		expect(distributed?.inputSchema.properties).not.toHaveProperty(
			"componentSpacing",
		);
	});
});

describe("createMaketMermaidTool — happy path", () => {
	it("renders a simple flowchart and injects an SVG into the page", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		const res = await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);

		expect(res.isError).toBeUndefined();
		const html = documents.resolve("test")?.pages[0]?.html ?? "";
		expect(html).toMatch(/<svg/);
		expect(html).toMatch(/data-maket-mermaid="[A-Za-z0-9_-]+"/);
		const firstItem = (res.content as any[])[0];
		expect(firstItem?.text).toMatch(/Mermaid diagram injected/);
	});

	it.each([
		["flowchart", "graph TD\n  A-->B", 'data-from="A" data-to="B"'],
		[
			"sequence",
			"sequenceDiagram\n  Alice->>Bob: Hello",
			'data-from="Alice" data-to="Bob"',
		],
		["ER", "erDiagram\n  CUSTOMER ||--o{ ORDER : places", 'data-id="ORDER"'],
	])(
		"renders a %s through the public tool boundary",
		async (_kind, code, proof) => {
			const { documents, bus } = fixture();
			const tool = createMaketMermaidTool({ documents, bus });

			const res = await tool.handler({ doc: "test", page: 1, code }, {} as any);

			expect(res.isError).toBeUndefined();
			const html = documents.resolve("test")?.pages[0]?.html ?? "";
			expect(html).toContain("<svg");
			expect(html).toContain('width="100%"');
			expect(html).toContain('height="100%"');
			expect(html).toContain(proof);
		},
	);

	it("inherits canonical diagram tokens from the document charte", async () => {
		const fx = fixture();
		attachCharte(fx, {
			color: { background: "#ffffff", text: "#111827", primary: "#7c3aed" },
			font: { body: "Source Sans 3" },
			diagram: {
				bg: "#f8fafc",
				border: "#94a3b8",
				nodeSpacing: "36px",
			},
		});
		const tool = createMaketMermaidTool({
			documents: fx.documents,
			bus: fx.bus,
		});

		const res = await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);

		expect(res.isError).toBeUndefined();
		const html = fx.documents.resolve("test")?.pages[0]?.html ?? "";
		expect(html).toContain("--bg:#f8fafc");
		expect(html).toContain("--fg:#111827");
		expect(html).toContain("--accent:#7c3aed");
		expect(html).toContain("--border:#94a3b8");
		expect(html).toContain("Source Sans 3");
	});

	it("accepts explicit charte token references and direct overrides", async () => {
		const fx = fixture();
		attachCharte(fx, {
			color: { paper: "#fffdf5", ink: "#172554", signal: "#ea580c" },
			spacing: { airy: "72px" },
		});
		const tool = createMaketMermaidTool({
			documents: fx.documents,
			bus: fx.bus,
		});

		const res = await tool.handler(
			{
				doc: "test",
				page: 1,
				code: "graph TD\n  A-->B",
				tokenRefs: {
					bg: "color.paper",
					fg: "color.ink",
					accent: "color.signal",
					layerSpacing: "spacing.airy",
				},
				accent: "#2563eb",
				transparent: true,
			},
			{} as any,
		);

		expect(res.isError).toBeUndefined();
		const html = fx.documents.resolve("test")?.pages[0]?.html ?? "";
		expect(html).toContain("--bg:#fffdf5");
		expect(html).toContain("--fg:#172554");
		expect(html).toContain("--accent:#2563eb");
		expect(html).not.toContain("background:var(--bg)");
	});

	it("keeps wrapper dimensions and data-id inside their HTML attributes", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		const res = await tool.handler(
			{
				doc: "test",
				page: 1,
				code: "graph TD\n  A-->B",
				dataId: 'diagram" data-review="id-injected',
				width: '100%" data-review="width-injected',
				height: '120mm"></div><img src="https://example.test/probe',
			},
			{} as any,
		);

		expect(res.isError).toBeUndefined();
		const html = documents.resolve("test")?.pages[0]?.html ?? "";
		expect(html).not.toContain('data-review="id-injected"');
		expect(html).not.toContain('data-review="width-injected"');
		expect(html).not.toContain("<img");
	});

	it("rejects a missing or unsafe token reference without mutating the page", async () => {
		const fx = fixture();
		attachCharte(fx, { color: { primary: "#2563eb" } });
		const tool = createMaketMermaidTool({
			documents: fx.documents,
			bus: fx.bus,
		});

		const missing = await tool.handler(
			{
				doc: "test",
				page: 1,
				code: "graph TD\n  A-->B",
				tokenRefs: { bg: "color.missing" },
			},
			{} as any,
		);
		const unsafe = await tool.handler(
			{
				doc: "test",
				page: 1,
				code: "graph TD\n  A-->B",
				bg: "red; background:url(https://example.test)",
			},
			{} as any,
		);

		expect(missing.isError).toBe(true);
		expect((missing.content as any[])[0]?.text).toMatch(/color\.missing/);
		expect(unsafe.isError).toBe(true);
		expect(fx.documents.resolve("test")?.pages[0]?.html ?? "").toBe("");
	});

	it("rejects unsupported density and source-level styling without mutation", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });
		const density = await tool.handler(
			{
				doc: "test",
				page: 1,
				code: "sequenceDiagram\n  Alice->>Bob: Hello",
				nodeSpacing: 40,
			},
			{} as any,
		);
		const styling = await tool.handler(
			{
				doc: "test",
				page: 1,
				code: "graph TD\n  A-->B\n  classDef custom fill:#f00",
			},
			{} as any,
		);

		expect(density.isError).toBe(true);
		expect(styling.isError).toBe(true);
		expect(documents.resolve("test")?.pages[0]?.html ?? "").toBe("");
	});

	it("auto-generates sequential dataIds (mermaid-1, mermaid-2, ...)", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);
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

		await tool.handler(
			{ doc: "test", page: 1, code: "graph TD\n  A-->B", dataId: "diag" },
			{} as any,
		);
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

		const res = await tool.handler(
			{
				doc: "test",
				page: 1,
				code: "graph TD\n  Alpha-->Beta\n  Beta-->Gamma",
				dataId: "diag",
			},
			{} as any,
		);

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

		const res = await tool.handler(
			{ doc: "ghost", page: 1, code: "graph TD\n  A-->B" },
			{} as any,
		);

		expect(res.isError).toBe(true);
		const firstItem = (res.content as any[])[0];
		expect(firstItem?.text).toMatch(/not found/i);
	});

	it("returns an error when the page index is out of range", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		const res = await tool.handler(
			{ doc: "test", page: 99, code: "graph TD\n  A-->B" },
			{} as any,
		);

		expect(res.isError).toBe(true);
		const firstItem = (res.content as any[])[0];
		expect(firstItem?.text).toMatch(/Page 99 not found/);
	});

	it("returns an error when the Mermaid code is malformed", async () => {
		const { documents, bus } = fixture();
		const tool = createMaketMermaidTool({ documents, bus });

		const res = await tool.handler(
			{ doc: "test", page: 1, code: "this is not mermaid syntax at all" },
			{} as any,
		);

		expect(res.isError).toBe(true);
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
