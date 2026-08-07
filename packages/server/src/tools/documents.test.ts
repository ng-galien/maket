import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collection } from "@maket/shared";
import { describe, expect, it, vi } from "vitest";
import { decodeBundle } from "../lib/maket-format.js";
import { createBus } from "../services/bus.js";
import { createCollections } from "../services/collections.js";
import type { Config } from "../services/config.js";
import { createDocuments } from "../services/documents.js";
import { createPending } from "../services/pending.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketDocTool, documentsPack } from "./documents.js";

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const pending = createPending({ bus });
	const collections = createCollections({ bus, documents, store });
	const config = { EXPORTS_DIR: "/tmp" } as unknown as Config;
	return { store, bus, documents, config, pending, collections };
}

const NO_EXTRA = {} as any;

function makeDoc(name: string, pageCount = 1) {
	const pages = Array.from({ length: pageCount }, (_, i) => ({
		name: `P${i + 1}`,
		elements: [],
		html: `<div data-id="e${i}">x</div>`,
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

describe("documentsPack — registration", () => {
	it("declares id and deps", () => {
		expect(documentsPack.id).toBe("documents");
		expect(documentsPack.requires).toEqual(
			expect.arrayContaining(["documents", "bus", "collections"]),
		);
	});
});

describe("maket_doc — action=new", () => {
	it("creates a new document with canvas + charte and emits events", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const created = vi.fn();
		const toast = vi.fn();
		bus.on("document:created", created);
		bus.on("toast", toast);

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
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
		const { store, bus, documents, config, pending, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "new", doc: "d2" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		const d = documents.resolve("d2");
		expect(d?.canvas.format).toBe("A3");
		expect(d?.canvas.orientation).toBe("portrait");
		expect(d?.category).toBe("general");
		store.close();
	});

	it("errors when doc is missing", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "new" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the name already exists", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("dup"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "new", doc: "dup" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=list", () => {
	it("groups documents by category", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
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

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/affiches \(2\)/);
		expect(txt).toMatch(/tracts \(1\)/);
		store.close();
	});

	it("renders slash-separated categories as a hierarchy", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const brief = makeDoc("brief");
		brief.category = "clients/acme";
		const proposal = makeDoc("proposal");
		proposal.category = "clients/acme/proposals";
		store.saveDoc(brief);
		store.saveDoc(proposal);
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const result = await tool.handler({ action: "list" }, NO_EXTRA);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(body).toContain("clients (2)");
		expect(body).toContain("  acme (2)");
		expect(body).toContain("    proposals (1)");
		store.close();
	});

	it("returns placeholder when no documents", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		expect((res.content[0] as any).text).toBe("No documents.");
		store.close();
	});
});

describe("maket_doc — action=delete", () => {
	it("refuses to delete the only document", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("solo"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "delete", doc: "solo" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("deletes an existing document and emits events", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();

		const deleted = vi.fn();
		const toast = vi.fn();
		bus.on("document:deleted", deleted);
		bus.on("toast", toast);

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "delete", doc: "a" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		expect(documents.resolve("a")).toBeNull();
		expect(store.loadOne("a")).toBeNull();
		expect(deleted).toHaveBeenCalledWith({ docName: "a" });
		expect(toast).toHaveBeenCalled();
		store.close();
	});

	it("errors when the document is missing", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
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
		const { store, bus, documents, config, pending, collections } = fixture();
		const src = makeDoc("orig", 2);
		src.meta.charte = "brand";
		store.saveDoc(src);
		documents.loadAll();

		const created = vi.fn();
		bus.on("document:created", created);

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler(
			{ action: "duplicate", doc: "orig", name: "copy" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const clone = documents.resolve("copy");
		expect(clone?.pages).toHaveLength(2);
		expect(clone?.meta.charte).toBe("brand");
		if (clone?.pages[0]) clone.pages[0].name = "mutated";
		expect(documents.resolve("orig")?.pages[0]?.name).toBe("P1");
		expect(created).toHaveBeenCalledWith({ docName: "copy" });
		expect(store.loadOne("copy")?.name).toBe("copy");
		store.close();
	});

	it("errors when the source is missing", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler(
			{ action: "duplicate", doc: "ghost", name: "copy" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the target name already exists", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler(
			{ action: "duplicate", doc: "a", name: "b" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=meta", () => {
	it("errors when the document does not exist", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "meta", doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("updates in-memory meta fields and emits meta:updated", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("poster"));
		documents.loadAll();

		const listener = vi.fn();
		bus.on("meta:updated", listener);

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
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
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("clamp"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		await tool.handler({ action: "meta", doc: "clamp", rating: 99 }, NO_EXTRA);
		expect(documents.resolve("clamp")?.meta.rating).toBe(5);
		await tool.handler({ action: "meta", doc: "clamp", rating: -3 }, NO_EXTRA);
		expect(documents.resolve("clamp")?.meta.rating).toBe(0);
		store.close();
	});
});

describe("maket_doc — lock enforcement", () => {
	it("refuses delete/rename/meta on a locked doc", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const d = makeDoc("locked");
		d.meta.locked = true;
		store.saveDoc(d);
		store.saveDoc(makeDoc("other"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});

		expect(
			(await tool.handler({ action: "delete", doc: "locked" }, NO_EXTRA))
				.isError,
		).toBe(true);
		expect(
			(
				await tool.handler(
					{ action: "rename", doc: "locked", name: "x" },
					NO_EXTRA,
				)
			).isError,
		).toBe(true);
		expect(
			(
				await tool.handler(
					{ action: "meta", doc: "locked", designNotes: "ignored" },
					NO_EXTRA,
				)
			).isError,
		).toBe(true);
		expect(documents.resolve("locked")?.meta.designNotes).toBeUndefined();
		store.close();
	});

	it("clears locked on duplicate so the clone is editable", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const d = makeDoc("src");
		d.meta.locked = true;
		store.saveDoc(d);
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});

		const res = await tool.handler(
			{ action: "duplicate", doc: "src", name: "copy" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(documents.resolve("copy")?.meta.locked).toBe(false);
		store.close();
	});
});

describe("maket_doc — action=rename", () => {
	it("renames a document in memory and store", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("old"));
		store.saveDoc(makeDoc("other"));
		documents.loadAll();

		const loaded = vi.fn();
		bus.on("document:loaded", loaded);

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
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
		const { store, bus, documents, config, pending, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler(
			{ action: "rename", doc: "ghost", name: "x" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the target name already exists", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler(
			{ action: "rename", doc: "a", name: "b" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=export / import", () => {
	async function withTmp<T>(run: (dir: string) => Promise<T>): Promise<T> {
		const dir = mkdtempSync(join(tmpdir(), "maket-bundle-"));
		try {
			return await run(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	it("exports then imports a bundle with its referenced charte", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, pending, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			const src = makeDoc("poster");
			src.meta.charte = "brand";
			store.saveDoc(src);
			store.saveCharte({
				name: "brand",
				tokens: { color: { primary: "#f00" } },
			});
			documents.loadAll();

			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
				pending,
				collections,
			});
			const exportRes = await tool.handler(
				{ action: "export", doc: "poster" },
				NO_EXTRA,
			);
			expect(exportRes.isError).toBeUndefined();
			const txt = (exportRes.content[0] as any).text as string;
			const bundlePath = txt.match(/→ (\S+\.maket)/)?.[1];
			expect(bundlePath).toBeDefined();

			const store2 = createSQLiteStore(":memory:");
			const bus2 = createBus();
			const documents2 = createDocuments({ store: store2 });
			const pending2 = createPending({ bus: bus2 });
			const collections2 = createCollections({
				bus: bus2,
				documents: documents2,
				store: store2,
			});
			const tool2 = createMaketDocTool({
				bus: bus2,
				documents: documents2,
				store: store2,
				config: cfg,
				pending: pending2,
				collections: collections2,
			});
			const importRes = await tool2.handler(
				{ action: "import", input: bundlePath },
				NO_EXTRA,
			);
			expect(importRes.isError).toBeUndefined();
			expect(documents2.resolve("poster")?.meta.charte).toBe("brand");
			expect(store2.loadCharte("brand")?.tokens.color?.primary).toBe("#f00");

			store.close();
			store2.close();
		});
	});

	it("exports referenced collections in the MCP bundle", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, pending, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			const doc = makeDoc("collection-poster");
			const page = doc.pages[0];
			if (!page) throw new Error("Expected document fixture to have a page");
			page.collection = { name: "clients" };
			store.saveDoc(doc);
			const collection: Collection = {
				name: "clients",
				description: "Clients",
				schema: {
					type: "object",
					properties: {
						client_name: { type: "string", title: "Client" },
					},
					required: ["client_name"],
					additionalProperties: false,
				},
				members: [
					{
						id: "member_1",
						position: 0,
						data: { client_name: "Acme" },
					},
				],
			};
			store.saveCollection(collection);
			documents.loadAll();

			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
				pending,
				collections,
			});
			const exportRes = await tool.handler(
				{ action: "export", doc: "collection-poster" },
				NO_EXTRA,
			);
			expect(exportRes.isError).toBeUndefined();
			const txt = (exportRes.content[0] as any).text as string;
			const bundlePath = txt.match(/→ (\S+\.maket)/)?.[1];
			expect(bundlePath).toBeDefined();

			const bundle = await decodeBundle(readFileSync(bundlePath as string));
			expect(bundle.collections).toEqual([collection]);

			const structureOnly = await tool.handler(
				{
					action: "export",
					doc: "collection-poster",
					output: "collection-structure",
					include_assets: false,
				},
				NO_EXTRA,
			);
			const structurePath = (
				(structureOnly.content[0] as any).text as string
			).match(/→ (\S+\.maket)/)?.[1];
			expect(structurePath).toBeDefined();
			const structureBundle = await decodeBundle(
				readFileSync(structurePath as string),
			);
			expect(structureBundle.collections).toEqual([collection]);
			store.close();
		});
	});

	it("renames colliding document names on import without overwriting", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, pending, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			store.saveDoc(makeDoc("flyer"));
			documents.loadAll();

			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
				pending,
				collections,
			});
			const exportRes = await tool.handler(
				{ action: "export", doc: "flyer" },
				NO_EXTRA,
			);
			const bundlePath = ((exportRes.content[0] as any).text as string).match(
				/→ (\S+\.maket)/,
			)?.[1];
			expect(bundlePath).toBeDefined();

			const importRes = await tool.handler(
				{ action: "import", input: bundlePath },
				NO_EXTRA,
			);
			expect(importRes.isError).toBeUndefined();
			expect(documents.resolve("flyer")).not.toBeNull();
			expect(documents.resolve("flyer (imported)")).not.toBeNull();
			store.close();
		});
	});

	it("exports every document when no doc filter is given", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, pending, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			store.saveDoc(makeDoc("a"));
			store.saveDoc(makeDoc("b"));
			documents.loadAll();

			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
				pending,
				collections,
			});
			const exportRes = await tool.handler({ action: "export" }, NO_EXTRA);
			expect(exportRes.isError).toBeUndefined();
			const txt = (exportRes.content[0] as any).text as string;
			expect(txt).toMatch(/Exported 2 document/);
			store.close();
		});
	});

	it("errors when import input is missing", async () => {
		const { store, bus, documents, config, pending, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			pending,
			collections,
		});
		const res = await tool.handler({ action: "import" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when import file is not a bundle", async () => {
		await withTmp(async (dir) => {
			const { writeFileSync } = await import("node:fs");
			const { store, bus, documents, pending, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			const garbage = join(dir, "garbage.maket");
			writeFileSync(garbage, Buffer.from("not a gzip"));
			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
				pending,
				collections,
			});
			const res = await tool.handler(
				{ action: "import", input: garbage },
				NO_EXTRA,
			);
			expect(res.isError).toBe(true);
			store.close();
		});
	});
});
