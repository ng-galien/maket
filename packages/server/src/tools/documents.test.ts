import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collection } from "@maket/shared";
import { describe, expect, it, vi } from "vitest";
import { decodeBundle } from "../lib/maket-format.js";
import { createAnnotations } from "../services/annotations.js";
import { createBundleExportService } from "../services/bundle-export.js";
import { createBundleImportService } from "../services/bundle-import.js";
import { createBus } from "../services/bus.js";
import { createCollectionRenderer } from "../services/collection-renderer.js";
import {
	type Collections,
	createCollections,
} from "../services/collections.js";
import type { Config } from "../services/config.js";
import { createDocumentStates } from "../services/document-states.js";
import { createDocuments } from "../services/documents.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import {
	createMaketDocTool as createMaketDocToolFactory,
	type DocumentsDeps,
	documentsPack,
} from "./documents.js";

type TestDocumentsDeps = Omit<
	DocumentsDeps,
	"bundleExportService" | "bundleImportService"
> & {
	collections: Collections;
};

function createMaketDocTool(deps: TestDocumentsDeps) {
	const { collections, ...toolDeps } = deps;
	return createMaketDocToolFactory({
		...toolDeps,
		bundleExportService: createBundleExportService({
			documents: deps.documents,
			documentRenderer: { render: (document) => document },
			collections,
			store: deps.store,
			config: deps.config,
		}),
		bundleImportService: createBundleImportService({
			documents: deps.documents,
			documentStates: createDocumentStates({
				bus: deps.bus,
				documents: deps.documents,
				store: deps.store,
			}),
			store: deps.store,
			bus: deps.bus,
			config: deps.config,
		}),
	});
}

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const collections = createCollections({ bus, documents, store });
	const config = { EXPORTS_DIR: "/tmp" } as unknown as Config;
	return { store, bus, documents, config, collections };
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
			expect.arrayContaining([
				"documents",
				"bus",
				"bundleExportService",
				"bundleImportService",
			]),
		);
	});
});

describe("maket_doc — action=new", () => {
	it("creates a new document with canvas + charte and emits events", async () => {
		const { store, bus, documents, config, collections } = fixture();
		const created = vi.fn();
		const toast = vi.fn();
		bus.on("document:created", created);
		bus.on("toast", toast);

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
		const { store, bus, documents, config, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
		const { store, bus, documents, config, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const res = await tool.handler({ action: "new" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when the name already exists", async () => {
		const { store, bus, documents, config, collections } = fixture();
		store.saveDoc(makeDoc("dup"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const res = await tool.handler({ action: "new", doc: "dup" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=list", () => {
	it("groups documents by category", async () => {
		const { store, bus, documents, config, collections } = fixture();
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
			collections,
		});
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/affiches \(2\)/);
		expect(txt).toMatch(/tracts \(1\)/);
		store.close();
	});

	it("renders slash-separated categories as a hierarchy", async () => {
		const { store, bus, documents, config, collections } = fixture();
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
		const { store, bus, documents, config, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		expect((res.content[0] as any).text).toBe("No documents.");
		store.close();
	});
});

describe("maket_doc — action=link", () => {
	it("returns a stable reading path with owning workspace context without changing focus", async () => {
		const { store, bus, documents, config, collections } = fixture();
		config.BASE_PATH = "/mobile/apps/maket";
		const doc = makeDoc("Review proposal");
		doc.meta.structuredWorkspace = {
			role: "item",
			workspaceId: "workspace-1",
			collectionId: "decisions",
			itemId: "decision-1",
			bindingId: "decision",
		};
		store.saveDoc(doc);
		const focused = vi.fn();
		bus.on("document:focused", focused);
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const result = await tool.handler(
			{ action: "link", doc: doc.name },
			NO_EXTRA,
		);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(JSON.parse(body)).toEqual({
			documentId: doc.id,
			path: `/mobile/apps/maket/documents/${doc.id}/read?workspace=workspace-1&collection=decisions`,
		});
		expect(focused).not.toHaveBeenCalled();
		store.close();
	});
});

describe("maket_doc — action=lookup", () => {
	function lookupFixture() {
		const context = fixture();
		const synthesis = makeDoc("Synthesis", 2);
		const board = makeDoc("Topic board");
		for (const doc of [synthesis, board]) {
			context.documents.all().set(doc.name, doc);
			context.documents.persist(doc.name);
		}
		const states = createDocumentStates({
			bus: context.bus,
			documents: context.documents,
			store: context.store,
		});
		states.initialize(
			board.name,
			{ type: "object", properties: { count: { type: "integer" } } },
			{ count: 0 },
		);
		states.patch(board.name, 1, [{ op: "replace", path: "/count", value: 1 }]);
		states.patch(board.name, 2, [{ op: "replace", path: "/count", value: 2 }]);
		const tool = createMaketDocTool(context);
		const emitted = vi.fn();
		const emit = context.bus.emit.bind(context.bus);
		context.bus.emit = (event, payload) => {
			emitted(event);
			emit(event, payload);
		};
		const lookup = async (doc: string) => {
			const result = await tool.handler({ action: "lookup", doc }, NO_EXTRA);
			return {
				isError: result.isError,
				body: result.content[0]?.type === "text" ? result.content[0].text : "",
			};
		};
		return { ...context, synthesis, board, emitted, lookup };
	}

	it("reads identity, revision, page count and state revision without side effects", async () => {
		const { store, synthesis, board, emitted, lookup } = lookupFixture();
		const timestamps = store.listTimestamps();

		const stateful = await lookup("Topic board");
		const staticDoc = await lookup("Synthesis");

		expect(stateful.isError).toBeUndefined();
		expect(JSON.parse(stateful.body)).toEqual({
			name: "Topic board",
			id: board.id,
			revision: timestamps.get("Topic board"),
			pageCount: 1,
			dataModel: "state",
			stateRevision: 3,
		});
		expect(JSON.parse(staticDoc.body)).toMatchObject({
			id: synthesis.id,
			pageCount: 2,
			dataModel: "static",
			stateRevision: null,
		});
		expect(emitted).not.toHaveBeenCalled();
		expect(store.listTimestamps()).toEqual(timestamps);
		expect(board._displayed).toBeUndefined();
		store.close();
	});

	it("lists near matches when the exact name is absent", async () => {
		const { store, emitted, lookup } = lookupFixture();

		const typo = await lookup("Topic bord");
		const casing = await lookup("topic BOARD");
		const unrelated = await lookup("Quarterly invoice");

		expect(typo.isError).toBe(true);
		expect(typo.body).toContain(
			'Document "Topic bord" not found. Near matches: "Topic board".',
		);
		expect(typo.body).toContain("maket_doc action=lookup doc=Topic board");
		expect(casing.isError).toBe(true);
		expect(casing.body).toContain('Near matches: "Topic board"');
		expect(unrelated.isError).toBe(true);
		expect(unrelated.body).toBe(
			'Document "Quarterly invoice" not found. No near match.',
		);
		expect(emitted).not.toHaveBeenCalled();
		store.close();
	});
});

describe("maket_doc — action=delete", () => {
	it("refuses to delete the only document", async () => {
		const { store, bus, documents, config, collections } = fixture();
		store.saveDoc(makeDoc("solo"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const res = await tool.handler({ action: "delete", doc: "solo" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("deletes an existing document and emits events", async () => {
		const { store, bus, documents, config, collections } = fixture();
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
		const { store, bus, documents, config, collections } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const res = await tool.handler(
			{ action: "delete", doc: "ghost" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("refuses to bypass Structured Workspace ownership", async () => {
		const { store, bus, documents, config, collections } = fixture();
		const template = makeDoc("template");
		template.meta.structuredWorkspace = {
			role: "template",
			workspaceId: "workspace-1",
			templateRoles: [
				{ role: "collection", collectionId: "backlog" },
				{ role: "detail", collectionId: "backlog", bindingId: "task" },
			],
		};
		const instance = makeDoc("instance");
		instance.meta.structuredWorkspace = {
			role: "item",
			workspaceId: "workspace-1",
			collectionId: "backlog",
			itemId: "item-1",
			bindingId: "task",
		};
		store.saveDocs([template, instance, makeDoc("other")]);
		store.createStructuredWorkspace({
			id: "workspace-1",
			name: "Delivery",
			dataSchema: { type: "object" },
			representationSchema: {
				version: 1,
				collections: {
					backlog: {
						name: "Backlog",
						collectionTemplateDocumentId: template.id,
						bindings: {
							task: {
								schemaPath: "",
								detailTemplateDocumentId: template.id,
							},
						},
					},
				},
			},
		});
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});

		const templateResult = await tool.handler(
			{ action: "delete", doc: "template" },
			NO_EXTRA,
		);
		expect(templateResult.isError).toBe(true);
		expect(documents.resolve("template")).not.toBeNull();

		const instanceResult = await tool.handler(
			{ action: "delete", doc: "instance" },
			NO_EXTRA,
		);
		expect(instanceResult.isError).toBe(true);
		expect(documents.resolve("instance")).not.toBeNull();
		for (const mutation of [
			{ action: "rename", doc: "template", name: "renamed-template" },
			{ action: "meta", doc: "instance", category: "other" },
		] as const) {
			const result = await tool.handler(mutation, NO_EXTRA);
			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).toContain(
				"belongs to Workspace",
			);
		}
		expect(documents.resolve("template")?.name).toBe("template");
		expect(documents.resolve("instance")?.category).not.toBe("other");
		store.close();
	});
});

describe("maket_doc — action=duplicate", () => {
	it("clones a document with a new name", async () => {
		const { store, bus, documents, config, collections } = fixture();
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
		const { store, bus, documents, config, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
		const { store, bus, documents, config, collections } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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

describe("maket_doc — action=pin/unpin", () => {
	function pinFixture(names: string[]) {
		const { store, bus, documents, config, collections } = fixture();
		for (const name of names) {
			const document = makeDoc(name);
			document.category = name === "notes" ? "archive" : "reports";
			store.saveDoc(document);
		}
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const call = async (args: Record<string, unknown>) => {
			const result = await tool.handler(args, NO_EXTRA);
			return {
				isError: result.isError,
				body: result.content[0]?.type === "text" ? result.content[0].text : "",
			};
		};
		return { store, bus, documents, call };
	}

	it("lists pinned documents first, most recently pinned first, and the rest as a category tree", async () => {
		const { store, bus, documents, call } = pinFixture([
			"board",
			"dossier",
			"notes",
			"synthesis",
		]);
		const events: unknown[] = [];
		bus.on("document:pinned", (payload) => events.push(payload));

		expect((await call({ action: "pin", doc: "synthesis" })).isError).toBe(
			undefined,
		);
		await call({ action: "pin", doc: "board" });

		const listed = (await call({ action: "list" })).body.split("\n");
		expect(listed.slice(0, 3)).toEqual([
			"pinned (2)",
			"  - 📌 board (A4 portrait, 1 el.) · reports",
			"  - 📌 synthesis (A4 portrait, 1 el.) · reports",
		]);
		expect(listed.slice(3)).toEqual([
			"archive (1)",
			"  - notes (A4 portrait, 1 el.)",
			"reports (1)",
			"  - dossier (A4 portrait, 1 el.)",
		]);
		expect(events).toEqual([
			{ docName: "synthesis", pinnedAt: expect.any(String) },
			{ docName: "board", pinnedAt: expect.any(String) },
		]);
		const reloaded = createDocuments({ store });
		reloaded.loadAll();
		expect(reloaded.resolve("synthesis")?.pinnedAt).toBe(
			documents.resolve("synthesis")?.pinnedAt,
		);
		store.close();
	});

	it("keeps an already pinned document in place and unpins it back into its category", async () => {
		const { store, bus, documents, call } = pinFixture(["board", "synthesis"]);
		await call({ action: "pin", doc: "synthesis" });
		await call({ action: "pin", doc: "board" });
		const events: unknown[] = [];
		bus.on("document:pinned", (payload) => events.push(payload));

		const repeated = await call({ action: "pin", doc: "synthesis" });
		expect(repeated).toEqual({
			isError: undefined,
			body: '"synthesis" is already pinned',
		});
		expect((await call({ action: "list" })).body.split("\n")[1]).toContain(
			"board",
		);

		await call({ action: "unpin", doc: "board" });
		expect((await call({ action: "list" })).body.split("\n")).toEqual([
			"pinned (1)",
			"  - 📌 synthesis (A4 portrait, 1 el.) · reports",
			"reports (1)",
			"  - board (A4 portrait, 1 el.)",
		]);
		expect(events).toEqual([{ docName: "board", pinnedAt: null }]);
		expect(store.loadOne("board")?.pinnedAt).toBeNull();
		expect(documents.resolve("board")?.pinnedAt).toBeNull();
		store.close();
	});

	it("pins a locked document and refuses an unknown one", async () => {
		const { store, documents, call } = pinFixture(["board"]);
		const board = documents.resolve("board");
		if (board) board.meta.locked = true;

		expect((await call({ action: "pin", doc: "board" })).isError).toBe(
			undefined,
		);
		expect(documents.resolve("board")?.pinnedAt).toEqual(expect.any(String));
		expect(await call({ action: "unpin", doc: "missing" })).toEqual({
			isError: true,
			body: 'Document "missing" not found',
		});
		expect((await call({ action: "pin" })).isError).toBe(true);
		store.close();
	});
});

describe("maket_doc — action=meta", () => {
	it("errors when the document does not exist", async () => {
		const { store, bus, documents, config, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const res = await tool.handler({ action: "meta", doc: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("persists metadata and emits updates when attaching and detaching a charte", async () => {
		const { store, bus, documents, config, collections } = fixture();
		store.saveDoc(makeDoc("poster"));
		documents.loadAll();

		const listener = vi.fn();
		bus.on("meta:updated", listener);

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
		expect(store.loadOne("poster")?.meta.charte).toBe("primary");

		await tool.handler({ action: "meta", doc: "poster", charte: "" }, NO_EXTRA);
		expect(documents.resolve("poster")?.meta.charte).toBeUndefined();
		expect(store.loadOne("poster")?.meta.charte).toBeUndefined();
		expect(listener).toHaveBeenCalledTimes(2);
		store.close();
	});

	it("clamps rating into [0, 5]", async () => {
		const { store, bus, documents, config, collections } = fixture();
		store.saveDoc(makeDoc("clamp"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
		const { store, bus, documents, config, collections } = fixture();
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
		const { store, bus, documents, config, collections } = fixture();
		const d = makeDoc("src");
		d.meta.locked = true;
		store.saveDoc(d);
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
	it("renames a state-backed document without changing its state identity", async () => {
		const { store, bus, documents, config, collections } = fixture();
		const stateDoc = makeDoc("living");
		stateDoc.dataModel = "state";
		store.saveDoc(stateDoc);
		store.initializeDocumentState(
			stateDoc.id,
			{
				type: "object",
				properties: { title: { type: "string" } },
			},
			{ title: "Stable" },
		);
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});

		const result = await tool.handler(
			{ action: "rename", doc: "living", name: "renamed" },
			NO_EXTRA,
		);

		expect(result.isError).toBeUndefined();
		expect(documents.resolve("renamed")?.id).toBe(stateDoc.id);
		expect(store.loadCurrentDocumentState(stateDoc.id)?.data).toEqual({
			title: "Stable",
		});
		store.close();
	});

	it("renames a document in memory and store", async () => {
		const { store, bus, documents, config, collections } = fixture();
		store.saveDoc(makeDoc("old"));
		store.saveDoc(makeDoc("other"));
		documents.loadAll();
		const annotations = createAnnotations({ bus, store });
		annotations.create({
			id: "rename-note",
			docName: "old",
			pageIndex: 0,
			elementId: "e0",
			type: "note",
			text: "Keep me",
		});

		const renamed = vi.fn();
		bus.on("document:renamed", renamed);

		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
		expect(annotations.forDoc("new")).toEqual([
			expect.objectContaining({ id: "rename-note", docName: "new" }),
		]);
		expect(renamed).toHaveBeenCalledWith({ oldName: "old", docName: "new" });
		store.close();
	});

	it("errors when the source is missing", async () => {
		const { store, bus, documents, config, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
		const { store, bus, documents, config, collections } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
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
			const { store, bus, documents, collections } = fixture();
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

	it("carries the pin timestamp through export and import", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			store.saveDoc(makeDoc("synthesis"));
			store.saveDoc(makeDoc("draft"));
			documents.loadAll();
			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
				collections,
			});
			await tool.handler({ action: "pin", doc: "synthesis" }, NO_EXTRA);
			const pinnedAt = documents.resolve("synthesis")?.pinnedAt;
			const exported = await tool.handler(
				{ action: "export", docs: ["synthesis", "draft"] },
				NO_EXTRA,
			);
			const bundlePath = ((exported.content[0] as any).text as string).match(
				/→ (\S+\.maket)/,
			)?.[1];
			expect(bundlePath).toBeDefined();
			const bundle = await decodeBundle(readFileSync(bundlePath as string));
			expect(
				bundle.documents.map(({ name, pinnedAt }) => ({ name, pinnedAt })),
			).toEqual([
				{ name: "synthesis", pinnedAt },
				{ name: "draft", pinnedAt: undefined },
			]);

			const store2 = createSQLiteStore(":memory:");
			const bus2 = createBus();
			const documents2 = createDocuments({ store: store2 });
			const tool2 = createMaketDocTool({
				bus: bus2,
				documents: documents2,
				store: store2,
				config: cfg,
				collections: createCollections({
					bus: bus2,
					documents: documents2,
					store: store2,
				}),
			});
			const imported = await tool2.handler(
				{ action: "import", input: bundlePath },
				NO_EXTRA,
			);
			expect(imported.isError).toBeUndefined();
			expect(store2.loadOne("synthesis")?.pinnedAt).toBe(pinnedAt);
			expect(store2.loadOne("draft")?.pinnedAt).toBeNull();

			store.close();
			store2.close();
		});
	});

	it("round-trips document annotations through the public MCP export and import", async () => {
		await withTmp(async (dir) => {
			const source = fixture();
			const config = { EXPORTS_DIR: dir } as unknown as Config;
			const document = makeDoc("annotated-poster");
			source.store.saveDoc(document);
			source.documents.loadAll();
			const annotations = createAnnotations({
				bus: source.bus,
				store: source.store,
			});
			annotations.create({
				id: "source-note",
				docName: document.name,
				pageIndex: 0,
				elementId: "e0",
				type: "note",
				text: "Keep this annotation with the document",
				ts: 1234,
			});
			annotations.create({
				id: "workspace-note",
				type: "note",
				text: "Do not attach workspace notes to a document bundle",
				ts: 1235,
			});

			const exportTool = createMaketDocTool({
				bus: source.bus,
				documents: source.documents,
				store: source.store,
				config,
				collections: source.collections,
			});
			const exportResult = await exportTool.handler(
				{ action: "export", doc: document.name },
				NO_EXTRA,
			);
			expect(exportResult.isError).toBeUndefined();
			const output = (exportResult.content[0] as { text: string }).text;
			const bundlePath = output.match(/→ (\S+\.maket)/)?.[1];
			expect(bundlePath).toBeDefined();
			const bundle = await decodeBundle(readFileSync(bundlePath as string));
			expect(bundle.version).toBe(2);
			expect(bundle.annotations).toEqual([
				{
					documentId: document.id,
					pageIndex: 0,
					elementId: "e0",
					type: "note",
					text: "Keep this annotation with the document",
					ts: 1234,
				},
			]);

			const target = fixture();
			target.store.saveDoc(makeDoc(document.name));
			target.documents.loadAll();
			const importTool = createMaketDocTool({
				bus: target.bus,
				documents: target.documents,
				store: target.store,
				config,
				collections: target.collections,
			});
			const importResult = await importTool.handler(
				{ action: "import", input: bundlePath },
				NO_EXTRA,
			);
			expect(importResult.isError).toBeUndefined();
			expect(
				target.documents.resolve("annotated-poster (imported)"),
			).not.toBeNull();
			expect(target.store.loadAnnotations()).toEqual([
				expect.objectContaining({
					docName: "annotated-poster (imported)",
					pageIndex: 0,
					elementId: "e0",
					type: "note",
					text: "Keep this annotation with the document",
					ts: 1234,
				}),
			]);
			expect(target.store.loadAnnotations()[0]?.id).not.toBe("source-note");

			source.store.close();
			target.store.close();
		});
	});

	it("round-trips a collection-backed document through MCP and renders it", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			const doc = makeDoc("collection-poster");
			const page = doc.pages[0];
			if (!page) throw new Error("Expected document fixture to have a page");
			page.collection = { name: "clients" };
			page.html = '<div data-id="e0">{{ client_name }}</div>';
			doc.dataModel = "collection";
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

			const target = fixture();
			const importTool = createMaketDocTool({
				bus: target.bus,
				documents: target.documents,
				store: target.store,
				config: cfg,
				collections: target.collections,
			});
			const importResult = await importTool.handler(
				{ action: "import", input: bundlePath },
				NO_EXTRA,
			);
			expect(importResult.isError).toBeUndefined();
			expect(target.collections.resolve("clients")).toEqual(collection);
			const imported = target.documents.resolveOrLoad("collection-poster");
			expect(imported).not.toBeNull();
			if (!imported) throw new Error("Expected imported collection document");
			const rendered = createCollectionRenderer({
				collections: target.collections,
			}).render(imported);
			expect(rendered.pages[0]?.html).toContain("Acme");

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
			target.store.close();
		});
	});

	it("round-trips a state-backed document through MCP at revision 1", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, collections } = fixture();
			const config = {
				ASSETS_DIR: dir,
				EXPORTS_DIR: dir,
			} as unknown as Config;
			const document = makeDoc("living-checklist");
			const page = document.pages[0];
			if (!page) throw new Error("Expected document fixture to have a page");
			page.html = "<h1>{{ state.title }}</h1>";
			store.saveDoc(document);
			documents.loadAll();
			const documentStates = createDocumentStates({ bus, documents, store });
			documentStates.initialize(
				"living-checklist",
				{
					type: "object",
					properties: { title: { type: "string" } },
					required: ["title"],
				},
				{ title: "Draft" },
			);
			documentStates.update("living-checklist", 1, { title: "Current" });

			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config,
				collections,
			});
			const exportResult = await tool.handler(
				{ action: "export", doc: "living-checklist" },
				NO_EXTRA,
			);

			expect(exportResult.isError).toBeUndefined();
			const output = (exportResult.content[0] as { text: string }).text;
			const bundlePath = output.match(/→ (\S+\.maket)/)?.[1];
			expect(bundlePath).toBeDefined();
			const bundle = await decodeBundle(readFileSync(bundlePath as string));
			expect(bundle.documents).toEqual([
				expect.objectContaining({
					name: "living-checklist",
					dataModel: "state",
				}),
			]);
			expect(bundle.documentStates).toEqual([
				{
					documentId: document.id,
					schema: {
						type: "object",
						properties: { title: { type: "string" } },
						required: ["title"],
					},
					data: { title: "Current" },
				},
			]);
			expect(bundle.documentStates[0]).not.toHaveProperty("revision");

			const target = fixture();
			const targetStates = createDocumentStates({
				bus: target.bus,
				documents: target.documents,
				store: target.store,
			});
			const importTool = createMaketDocTool({
				bus: target.bus,
				documents: target.documents,
				store: target.store,
				config,
				collections: target.collections,
			});
			const importResult = await importTool.handler(
				{ action: "import", input: bundlePath },
				NO_EXTRA,
			);
			expect(importResult.isError).toBeUndefined();
			expect(
				target.documents.resolveOrLoad("living-checklist")?.dataModel,
			).toBe("state");
			expect(targetStates.get("living-checklist")?.current).toEqual(
				expect.objectContaining({
					revision: 1,
					data: { title: "Current" },
				}),
			);
			expect(targetStates.history("living-checklist")).toHaveLength(1);
			store.close();
			target.store.close();
		});
	});

	it("keeps the revision retention of a state-backed document across export and import", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, collections } = fixture();
			const config = {
				ASSETS_DIR: dir,
				EXPORTS_DIR: dir,
			} as unknown as Config;
			const fed = makeDoc("fed-board");
			const unbounded = makeDoc("plain-board");
			for (const document of [fed, unbounded]) {
				const page = document.pages[0];
				if (page) page.html = "<h1>{{ state.title }}</h1>";
				store.saveDoc(document);
			}
			documents.loadAll();
			const documentStates = createDocumentStates({ bus, documents, store });
			const schema = {
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			};
			for (const name of ["fed-board", "plain-board"]) {
				documentStates.initialize(name, schema, { title: "Draft" });
			}
			documentStates.setRetention("fed-board", 2);
			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config,
				collections,
			});
			const exportResult = await tool.handler(
				{ action: "export", docs: ["fed-board", "plain-board"] },
				NO_EXTRA,
			);
			const bundlePath = (
				exportResult.content[0] as { text: string }
			).text.match(/→ (\S+\.maket)/)?.[1];
			const bundle = await decodeBundle(readFileSync(bundlePath as string));
			expect(
				bundle.documentStates.map(({ documentId, retention }) => ({
					documentId,
					retention,
				})),
			).toEqual(
				expect.arrayContaining([
					{ documentId: fed.id, retention: 2 },
					{ documentId: unbounded.id, retention: undefined },
				]),
			);

			const target = fixture();
			const targetStates = createDocumentStates({
				bus: target.bus,
				documents: target.documents,
				store: target.store,
			});
			const importResult = await createMaketDocTool({
				bus: target.bus,
				documents: target.documents,
				store: target.store,
				config,
				collections: target.collections,
			}).handler({ action: "import", input: bundlePath }, NO_EXTRA);
			expect(importResult.isError).toBeUndefined();
			expect(targetStates.get("fed-board")?.definition.retention).toBe(2);
			expect(targetStates.get("plain-board")?.definition.retention).toBe(null);
			for (const title of ["One", "Two", "Three"]) {
				const current = targetStates.get("fed-board")?.current.revision ?? 0;
				targetStates.update("fed-board", current, { title });
			}
			expect(
				targetStates.history("fed-board").map(({ revision }) => revision),
			).toEqual([4, 3, 2]);
			store.close();
			target.store.close();
		});
	});

	it("renames colliding document names on import without overwriting", async () => {
		await withTmp(async (dir) => {
			const { store, bus, documents, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			store.saveDoc(makeDoc("flyer"));
			documents.loadAll();

			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
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
			const { store, bus, documents, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			store.saveDoc(makeDoc("a"));
			store.saveDoc(makeDoc("b"));
			documents.loadAll();

			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
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
		const { store, bus, documents, config, collections } = fixture();
		const tool = createMaketDocTool({
			bus,
			documents,
			store,
			config,
			collections,
		});
		const res = await tool.handler({ action: "import" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		store.close();
	});

	it("errors when import file is not a bundle", async () => {
		await withTmp(async (dir) => {
			const { writeFileSync } = await import("node:fs");
			const { store, bus, documents, collections } = fixture();
			const cfg = { EXPORTS_DIR: dir } as unknown as Config;
			const garbage = join(dir, "garbage.maket");
			writeFileSync(garbage, Buffer.from("not a gzip"));
			const tool = createMaketDocTool({
				bus,
				documents,
				store,
				config: cfg,
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
