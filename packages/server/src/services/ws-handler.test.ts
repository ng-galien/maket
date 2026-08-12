import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { onboardingDocumentName } from "../lib/onboarding-document.js";
import { createDocument, type Document } from "../types.js";
import { createAnnotations } from "./annotations.js";
import { createAssetsService } from "./assets.js";
import { createBus } from "./bus.js";
import { createCollectionCursors } from "./collection-cursor.js";
import { createCollections } from "./collections.js";
import type { DocumentRenderer } from "./document-renderer.js";
import { createDocumentStates } from "./document-states.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";
import { createWsHandler } from "./ws-handler/index.js";
import { createWsRegistry } from "./ws-registry.js";

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

function rendererStub(
	render: (doc: Document) => Document = (doc) => doc,
): DocumentRenderer {
	return { render, stateView: () => null, statePages: () => [] };
}

function fixture(opts: { documentRenderer?: DocumentRenderer } = {}) {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const documentStates = createDocumentStates({ store, documents, bus });
	const pending = createAnnotations({ bus, store });
	const wsRegistry = createWsRegistry();
	const assetsDir = mkdtempSync(join(tmpdir(), "maket-ws-assets-"));
	const assets = createAssetsService({ assetsDir });
	const handler = createWsHandler({
		assets,
		bus,
		documentRenderer: opts.documentRenderer ?? rendererStub(),
		documentStates,
		documents,
		pending,
		store,
		wsRegistry,
	});
	return {
		store,
		bus,
		documents,
		documentStates,
		pending,
		handler,
		wsRegistry,
		assetsDir,
		dispose: () => {
			store.close();
			rmSync(assetsDir, { recursive: true, force: true });
		},
	};
}

const STUB_WS: any = { readyState: 1, send() {} };

describe("ws-handler — annotation persistence acknowledgement", () => {
	it("correlates successful writes and reports rejected writes to the browser", () => {
		const { store, documents, pending, handler, dispose } = fixture();
		store.saveDoc(makeDoc("annotated"));
		documents.loadAll();
		const ws = { readyState: 1, send: vi.fn() } as any;

		handler(
			{
				type: "annotation_create",
				requestId: "create-ok",
				annotation: {
					id: "annotation-ok",
					docName: "annotated",
					type: "note",
					text: "Persist me",
					ts: 1,
				},
			},
			ws,
		);
		handler(
			{
				type: "annotation_create",
				requestId: "create-rejected",
				annotation: {
					id: "annotation-rejected",
					docName: "missing",
					type: "note",
					text: "Keep this draft",
					ts: 2,
				},
			},
			ws,
		);

		expect(pending.all()).toEqual([
			expect.objectContaining({ id: "annotation-ok", text: "Persist me" }),
		]);
		expect(
			ws.send.mock.calls.map(([payload]: [string]) => JSON.parse(payload)),
		).toEqual([
			{
				type: "annotation_create_result",
				requestId: "create-ok",
				ok: true,
			},
			{
				type: "annotation_create_result",
				requestId: "create-rejected",
				ok: false,
				error: 'Document "missing" not found',
			},
		]);
		dispose();
	});
});

describe("ws-handler — living document state", () => {
	it("replaces one terminal value and acknowledges the resulting revision", () => {
		const { store, documents, documentStates, handler, dispose } = fixture();
		const doc = makeDoc("checklist");
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html = '<input type="checkbox" data-maket-bind="state.done">';
		store.saveDoc(doc);
		documents.loadAll();
		documentStates.initialize(
			"checklist",
			{
				type: "object",
				properties: { done: { type: "boolean" } },
				required: ["done"],
			},
			{ done: false },
		);
		const ws = { readyState: 1, send: vi.fn() } as any;

		handler(
			{
				type: "state_patch",
				requestId: "request-1",
				docName: "checklist",
				expectedRevision: 1,
				operation: { op: "replace", path: "/done", value: true },
			},
			ws,
		);

		expect(documentStates.get("checklist")?.current).toMatchObject({
			revision: 2,
			data: { done: true },
		});
		expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
			type: "state_patch_result",
			requestId: "request-1",
			ok: true,
			revision: 2,
		});
		dispose();
	});

	it("replaces text and select string values through the same terminal endpoint", () => {
		const { store, documents, documentStates, handler, dispose } = fixture();
		const doc = makeDoc("form-controls");
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'<input type="text" data-maket-bind="state.title"><select data-maket-bind="state.status"><option value="todo">À faire</option><option value="done">Fait</option></select>';
		store.saveDoc(doc);
		documents.loadAll();
		documentStates.initialize(
			"form-controls",
			{
				type: "object",
				properties: {
					title: { type: "string" },
					status: { type: "string", enum: ["todo", "done"] },
				},
				required: ["title", "status"],
			},
			{ title: "Opening", status: "todo" },
		);
		const ws = { readyState: 1, send: vi.fn() } as any;

		handler(
			{
				type: "state_patch",
				requestId: "request-title",
				docName: "form-controls",
				expectedRevision: 1,
				operation: { op: "replace", path: "/title", value: "Closing" },
			},
			ws,
		);
		handler(
			{
				type: "state_patch",
				requestId: "request-status",
				docName: "form-controls",
				expectedRevision: 2,
				operation: { op: "replace", path: "/status", value: "done" },
			},
			ws,
		);

		expect(documentStates.get("form-controls")?.current).toMatchObject({
			revision: 3,
			data: { title: "Closing", status: "done" },
		});
		expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({
			requestId: "request-title",
			ok: true,
			revision: 2,
		});
		expect(JSON.parse(ws.send.mock.calls[1][0])).toMatchObject({
			requestId: "request-status",
			ok: true,
			revision: 3,
		});
		dispose();
	});

	it("rejects terminal paths that are not exposed by an active binding", () => {
		const { store, documents, documentStates, handler, dispose } = fixture();
		const doc = makeDoc("conditional-form");
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html =
			'{{#state.visible}}<input type="text" data-maket-bind="state.secret">{{/state.visible}}';
		store.saveDoc(doc);
		documents.loadAll();
		documentStates.initialize(
			"conditional-form",
			{
				type: "object",
				properties: {
					visible: { type: "boolean" },
					secret: { type: "string" },
				},
				required: ["visible", "secret"],
			},
			{ visible: false, secret: "private" },
		);
		const ws = { readyState: 1, send: vi.fn() } as any;

		handler(
			{
				type: "state_patch",
				requestId: "request-hidden",
				docName: "conditional-form",
				expectedRevision: 1,
				operation: {
					op: "replace",
					path: "/secret",
					value: "exposed",
				},
			},
			ws,
		);

		expect(documentStates.get("conditional-form")?.current).toMatchObject({
			revision: 1,
			data: { visible: false, secret: "private" },
		});
		expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({
			type: "state_patch_result",
			requestId: "request-hidden",
			ok: false,
			error: expect.stringMatching(/not exposed by an active document binding/),
		});
		dispose();
	});

	it("rejects a stale terminal patch without changing authoritative state", () => {
		const { store, bus, documents, documentStates, handler, dispose } =
			fixture();
		const doc = makeDoc("checklist");
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html = '<input type="checkbox" data-maket-bind="state.done">';
		store.saveDoc(doc);
		documents.loadAll();
		documentStates.initialize(
			"checklist",
			{
				type: "object",
				properties: { done: { type: "boolean" } },
				required: ["done"],
			},
			{ done: false },
		);
		const ws = { readyState: 1, send: vi.fn() } as any;
		const rebroadcast = vi.fn();
		bus.on("document:saved", rebroadcast);

		handler(
			{
				type: "state_patch",
				requestId: "request-stale",
				docName: "checklist",
				expectedRevision: 2,
				operation: { op: "replace", path: "/done", value: true },
			},
			ws,
		);

		expect(documentStates.get("checklist")?.current).toMatchObject({
			revision: 1,
			data: { done: false },
		});
		expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({
			type: "state_patch_result",
			requestId: "request-stale",
			ok: false,
			error: expect.stringMatching(/expected 2, current 1/),
		});
		expect(rebroadcast).toHaveBeenCalledWith({ docName: "checklist" });
		dispose();
	});
});

describe("ws-handler — lock guards", () => {
	it("refuses delete_document when the doc is locked", () => {
		const { store, bus, documents, handler, dispose } = fixture();
		const locked = makeDoc("locked");
		locked.meta.locked = true;
		store.saveDoc(locked);
		store.saveDoc(makeDoc("other"));
		documents.loadAll();
		const toast = vi.fn();
		bus.on("toast", toast);

		handler({ type: "delete_document", name: "locked" }, STUB_WS);

		expect(documents.resolve("locked")).not.toBeNull();
		expect(store.loadOne("locked")).not.toBeNull();
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringMatching(/locked/i) }),
		);
		dispose();
	});

	it("refuses rename_document when the doc is locked", () => {
		const { store, bus, documents, handler, dispose } = fixture();
		const locked = makeDoc("locked");
		locked.meta.locked = true;
		store.saveDoc(locked);
		documents.loadAll();
		const toast = vi.fn();
		bus.on("toast", toast);

		handler(
			{ type: "rename_document", name: "locked", newName: "renamed" },
			STUB_WS,
		);

		expect(documents.resolve("locked")).not.toBeNull();
		expect(documents.resolve("renamed")).toBeNull();
		expect(toast).toHaveBeenCalled();
		dispose();
	});

	it("refuses update_meta when the doc is locked", () => {
		const { store, bus, documents, handler, dispose } = fixture();
		const locked = makeDoc("locked");
		locked.meta.locked = true;
		store.saveDoc(locked);
		documents.loadAll();
		const toast = vi.fn();
		bus.on("toast", toast);

		handler(
			{
				type: "update_meta",
				docName: "locked",
				designNotes: "should be ignored",
			},
			STUB_WS,
		);

		expect(documents.resolve("locked")?.meta.designNotes).toBeUndefined();
		expect(toast).toHaveBeenCalled();
		dispose();
	});

	it("still allows lock_document to toggle a locked doc back to unlocked", () => {
		const { store, documents, handler, dispose } = fixture();
		const locked = makeDoc("locked");
		locked.meta.locked = true;
		store.saveDoc(locked);
		documents.loadAll();

		handler({ type: "lock_document", name: "locked", locked: false }, STUB_WS);

		expect(documents.resolve("locked")?.meta.locked).toBe(false);
		dispose();
	});
});

describe("ws-handler — document and canvas flows", () => {
	it("load_document sends a focused state and lazy-loads from the store", () => {
		const { store, handler, dispose } = fixture();
		store.saveDoc(makeDoc("lazy"));
		const ws = { readyState: 1, send: vi.fn() } as any;

		handler({ type: "load_document", name: "lazy" }, ws);

		expect(ws.send).toHaveBeenCalledOnce();
		const payload = JSON.parse(String(ws.send.mock.calls[0]?.[0])) as {
			type: string;
			doc: { name: string };
			addToWorkspace: boolean;
			focus: boolean;
		};
		expect(payload.type).toBe("state");
		expect(payload.doc.name).toBe("lazy");
		expect(payload.addToWorkspace).toBe(true);
		expect(payload.focus).toBe(true);
		dispose();
	});

	it("load_document sends the rendered projection without replacing the persisted template", () => {
		const render = vi.fn((doc: Document) => ({
			...doc,
			pages: doc.pages.map((page) => ({
				...page,
				html: page.html?.replace("{{ state.title }}", "Ready"),
			})),
		}));
		const { store, handler, dispose } = fixture({
			documentRenderer: rendererStub(render),
		});
		const doc = makeDoc("living");
		doc.dataModel = "state";
		const page = doc.pages[0];
		if (!page) throw new Error("living fixture requires one page");
		page.html = '<h1 data-id="title">{{ state.title }}</h1>';
		store.saveDoc(doc);
		const ws = { readyState: 1, send: vi.fn() } as any;

		handler({ type: "load_document", name: "living" }, ws);

		const payload = JSON.parse(String(ws.send.mock.calls[0]?.[0])) as {
			doc: Document;
		};
		expect(render).toHaveBeenCalledOnce();
		expect(payload.doc.pages[0]?.html).toContain("Ready");
		expect(store.loadOne("living")?.pages[0]?.html).toContain(
			"{{ state.title }}",
		);
		dispose();
	});

	it("workspace_update tracks which docs are displayed", () => {
		const { store, documents, handler, dispose } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();

		handler({ type: "workspace_update", displayed: ["b"] }, STUB_WS);

		expect(documents.resolve("a")?._displayed).toBe(false);
		expect(documents.resolve("b")?._displayed).toBe(true);
		dispose();
	});

	it("open_onboarding creates and focuses the built-in help document", () => {
		const { store, documents, handler, dispose } = fixture();
		const ws = { readyState: 1, send: vi.fn() } as any;

		handler({ type: "open_onboarding", lang: "fr" }, ws);

		const name = onboardingDocumentName();
		const stored = store.loadOne(name);
		expect(stored?.category).toBe("help");
		expect(documents.resolve(name)?.meta.locked).toBe(true);
		expect(ws.send).toHaveBeenCalledOnce();
		const payload = JSON.parse(String(ws.send.mock.calls[0]?.[0])) as {
			type: string;
			doc: { name: string };
			addToWorkspace: boolean;
			focus: boolean;
		};
		expect(payload.type).toBe("state");
		expect(payload.doc.name).toBe(name);
		expect(payload.addToWorkspace).toBe(true);
		expect(payload.focus).toBe(true);
		dispose();
	});

	it("open_onboarding keeps one stable help document across locales", () => {
		const { store, documents, handler, dispose } = fixture();
		const ws = { readyState: 1, send: vi.fn() } as any;

		handler({ type: "open_onboarding", lang: "fr" }, ws);
		handler({ type: "open_onboarding", lang: "en" }, ws);

		const name = onboardingDocumentName();
		expect(
			[...documents.all().keys()].filter((key) => key === name),
		).toHaveLength(1);
		expect(store.loadOne(name)?.pages[0]?.name).toBe("Help");
		expect(
			store.loadAll().filter((doc) => doc.category === "help"),
		).toHaveLength(1);
		dispose();
	});

	it("update_meta mutates fields, clamps rating, and persists", () => {
		const { store, documents, bus, handler, dispose } = fixture();
		store.saveDoc(makeDoc("meta"));
		documents.loadAll();
		const updated = vi.fn();
		bus.on("meta:updated", updated);

		handler(
			{
				type: "update_meta",
				docName: "meta",
				designNotes: "design",
				teamNotes: "team",
				rating: 9,
				charte: "brand",
				category: " clients / / social ",
			},
			STUB_WS,
		);

		expect(documents.resolve("meta")).toMatchObject({
			category: "clients/social",
			meta: {
				designNotes: "design",
				teamNotes: "team",
				rating: 5,
				charte: "brand",
			},
		});
		expect(store.loadOne("meta")?.meta.rating).toBe(5);
		expect(updated).toHaveBeenCalledWith({ docName: "meta" });
		dispose();
	});

	it("update_meta clears prose fields when the caller sends ``", () => {
		const { store, documents, handler, dispose } = fixture();
		const doc = makeDoc("meta-clear");
		doc.meta = { designNotes: "kept", teamNotes: "kept" };
		store.saveDoc(doc);
		documents.loadAll();

		handler(
			{
				type: "update_meta",
				docName: "meta-clear",
				designNotes: "",
				teamNotes: "",
			},
			STUB_WS,
		);

		expect(documents.resolve("meta-clear")?.meta).toMatchObject({
			designNotes: "",
			teamNotes: "",
		});
		dispose();
	});
});

describe("ws-handler — file and document mutations", () => {
	it("delete_asset removes the file, its thumb, db row, and emits assets:changed", () => {
		const { store, bus, handler, assetsDir, dispose } = fixture();
		const thumbsDir = join(assetsDir, "thumbs");
		mkdirSync(thumbsDir, { recursive: true });
		writeFileSync(join(assetsDir, "hero.png"), "hero");
		writeFileSync(join(thumbsDir, "hero.png.thumb.jpg"), "thumb");
		store.saveAsset({ filename: "hero.png", title: "Hero" });
		const changed = vi.fn();
		bus.on("assets:changed", changed);

		handler({ type: "delete_asset", filename: "hero.png" }, STUB_WS);

		expect(existsSync(join(assetsDir, "hero.png"))).toBe(false);
		expect(existsSync(join(thumbsDir, "hero.png.thumb.jpg"))).toBe(false);
		expect(store.loadAsset("hero.png")).toBeNull();
		expect(changed).toHaveBeenCalledWith({});
		dispose();
	});

	it("delete_document keeps the last remaining doc intact", () => {
		const { store, documents, handler, dispose } = fixture();
		store.saveDoc(makeDoc("solo"));
		documents.loadAll();

		handler({ type: "delete_document", name: "solo" }, STUB_WS);

		expect(documents.resolve("solo")).not.toBeNull();
		dispose();
	});

	it("rename_document succeeds and emits delete + load for the rename", () => {
		const { store, documents, pending, bus, handler, dispose } = fixture();
		store.saveDoc(makeDoc("old"));
		documents.loadAll();
		pending.create({
			id: "rename-note",
			docName: "old",
			pageIndex: 0,
			elementId: "e0",
			type: "note",
			text: "Keep me",
		});
		const deleted = vi.fn();
		const loaded = vi.fn();
		const toast = vi.fn();
		bus.on("document:deleted", deleted);
		bus.on("document:loaded", loaded);
		bus.on("toast", toast);

		handler({ type: "rename_document", name: "old", newName: "new" }, STUB_WS);

		expect(documents.resolve("old")).toBeNull();
		expect(documents.resolve("new")?.name).toBe("new");
		expect(pending.forDoc("new")).toEqual([
			expect.objectContaining({ id: "rename-note", docName: "new" }),
		]);
		expect(deleted).toHaveBeenCalledWith({ docName: "old" });
		expect(loaded).toHaveBeenCalledWith({ docName: "new" });
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringMatching(/old.*new/i) }),
		);
		dispose();
	});

	it("duplicate_document clones pages and always unlocks the clone", () => {
		const { store, documents, bus, handler, dispose } = fixture();
		const src = makeDoc("source");
		src.meta.locked = true;
		src.pages = [
			{
				id: "page-source",
				name: "P1",
				elements: [{ id: "a" }],
				html: '<p data-id="a">A</p>',
			},
		];
		store.saveDoc(src);
		documents.loadAll();
		const created = vi.fn();
		bus.on("document:created", created);

		handler(
			{ type: "duplicate_document", name: "source", newName: "copy" },
			STUB_WS,
		);

		expect(documents.resolve("copy")).toMatchObject({
			name: "copy",
			meta: { locked: false },
			pages: [{ name: "P1", html: '<p data-id="a">A</p>' }],
		});
		expect(created).toHaveBeenCalledWith({ docName: "copy" });
		dispose();
	});
});

describe("ws-handler — text editing", () => {
	it("updates the targeted page html, strips active content, and emits document:saved", () => {
		const { store, documents, bus, handler, dispose } = fixture();
		const doc = createDocument({
			name: "editor",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "P1",
					elements: [],
					html: '<div data-id="a"><span>old</span></div>',
				},
				{
					name: "P2",
					elements: [],
					html: '<div data-id="b"><span>untouched</span></div>',
				},
			],
			activePage: 1,
		});
		store.saveDoc(doc);
		documents.loadAll();
		const savedEvt = vi.fn();
		bus.on("document:saved", savedEvt);

		handler(
			{
				type: "text_edit",
				docName: "editor",
				pageIndex: 0,
				elementId: "a",
				html: '<style>.x{}</style><script>alert(1)</script><img src="javascript:alert(1)"><span>new</span>',
			},
			STUB_WS,
		);

		const saved = documents.resolve("editor")?.pages[0]?.html ?? "";
		expect(saved).toContain("<span>new</span>");
		expect(saved).not.toContain("<style");
		expect(saved).not.toContain("<script");
		expect(saved).not.toContain("javascript:");
		expect(documents.resolve("editor")?.pages[1]?.html).toContain("untouched");
		expect(savedEvt).toHaveBeenCalledWith({ docName: "editor" });
		dispose();
	});

	it("rejects invalid state-template edits without changing persisted html", () => {
		const { store, documents, documentStates, handler, dispose } = fixture();
		const doc = createDocument({
			name: "state-editor",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					name: "P1",
					elements: [],
					html: '<div data-id="a">{{ state.title }}</div>',
				},
			],
		});
		store.saveDoc(doc);
		documents.loadAll();
		documentStates.initialize(
			"state-editor",
			{
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
			{ title: "Original" },
		);

		handler(
			{
				type: "text_edit",
				docName: "state-editor",
				pageIndex: 0,
				elementId: "a",
				html: "{{ page.number }}",
			},
			STUB_WS,
		);

		expect(documents.resolve("state-editor")?.pages[0]?.html).toBe(
			'<div data-id="a">{{ state.title }}</div>',
		);
		expect(store.loadOne("state-editor")?.pages[0]?.html).toBe(
			'<div data-id="a">{{ state.title }}</div>',
		);
		dispose();
	});

	it("rejects text edits on locked documents", () => {
		const { store, documents, handler, dispose } = fixture();
		const doc = makeDoc("locked-editor");
		const page = doc.pages[0];
		if (!page) throw new Error("Fixture page missing.");
		page.html = '<div data-id="a">Original</div>';
		doc.meta.locked = true;
		store.saveDoc(doc);
		documents.loadAll();

		handler(
			{
				type: "text_edit",
				docName: "locked-editor",
				pageIndex: 0,
				elementId: "a",
				html: "Changed",
			},
			STUB_WS,
		);

		expect(store.loadOne("locked-editor")?.pages[0]?.html).toContain(
			"Original",
		);
		dispose();
	});

	it("charte_save persists and emits charte:updated with CSS", () => {
		const { store, bus, handler, dispose } = fixture();
		const updates = vi.fn();
		bus.on("charte:updated", updates);

		handler(
			{
				type: "charte_save",
				name: "brand",
				description: "primary brand",
				tokens: { color: { primary: "#2563EB" } },
				voice: { personality: ["bold"] },
				rules: { titles: "sentence case" },
			},
			STUB_WS,
		);

		const stored = store.loadCharte("brand");
		expect(stored?.description).toBe("primary brand");
		expect(stored?.tokens.color?.primary).toBe("#2563EB");
		expect(stored?.voice?.personality).toEqual(["bold"]);
		expect(stored?.rules?.titles).toBe("sentence case");

		expect(updates).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "brand",
				css: expect.stringContaining("--charte-color-primary: #2563EB"),
			}),
		);
		dispose();
	});

	it("charte_save rejects empty name with an error toast", () => {
		const { store, bus, handler, dispose } = fixture();
		const toast = vi.fn();
		bus.on("toast", toast);

		handler({ type: "charte_save", name: "  " } as any, STUB_WS);

		expect(store.loadAllChartes()).toHaveLength(0);
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ level: "error" }),
		);
		dispose();
	});

	it("charte_save emits charte:updated with the font @import so clients live-reload Google Fonts", () => {
		const { bus, handler, dispose } = fixture();
		const updates = vi.fn();
		bus.on("charte:updated", updates);

		handler(
			{
				type: "charte_save",
				name: "brand",
				tokens: { font: { heading: "Fraunces", body: "Inter" } },
			},
			STUB_WS,
		);

		expect(updates).toHaveBeenCalledTimes(1);
		const css = (updates.mock.calls[0]?.[0] as { css: string } | undefined)
			?.css;
		// Font import emitted so client's ensureCharteFonts() picks up new Google Fonts.
		expect(css).toMatch(/@import\s+url\(['"]https:\/\/fonts\.googleapis\.com/);
		expect(css).toContain("family=Fraunces");
		expect(css).toContain("family=Inter");
		// Vars still present.
		expect(css).toMatch(/--charte-font-heading:\s*Fraunces/);
		dispose();
	});

	it.each([
		["tokens as string", { tokens: "oops" as unknown }],
		["tokens group value as array", { tokens: { color: ["#fff"] as unknown } }],
		[
			"tokens non-string value",
			{ tokens: { color: { primary: 42 as unknown } } },
		],
		["voice as array", { voice: ["nope" as unknown] }],
		["rules as number", { rules: 7 as unknown }],
	])(
		"charte_save rejects malformed payload (%s) without persisting",
		(_, extra) => {
			const { store, bus, handler, dispose } = fixture();
			const toast = vi.fn();
			const updates = vi.fn();
			bus.on("toast", toast);
			bus.on("charte:updated", updates);

			handler({ type: "charte_save", name: "brand", ...extra } as any, STUB_WS);

			expect(store.loadAllChartes()).toHaveLength(0);
			expect(updates).not.toHaveBeenCalled();
			expect(toast).toHaveBeenCalledWith(
				expect.objectContaining({ level: "error" }),
			);
			dispose();
		},
	);
});

describe("ws-handler — collection cursor", () => {
	function cursorFixture() {
		const base = fixture();
		const collections = createCollections({
			bus: base.bus,
			documents: base.documents,
			store: base.store,
		});
		const collectionCursors = createCollectionCursors({
			bus: base.bus,
			documents: base.documents,
			store: base.store,
		});
		const handler = createWsHandler({
			assets: createAssetsService({ assetsDir: base.assetsDir }),
			bus: base.bus,
			collections,
			collectionCursors,
			documentRenderer: rendererStub(),
			documentStates: base.documentStates,
			documents: base.documents,
			pending: base.pending,
			store: base.store,
			wsRegistry: base.wsRegistry,
		});
		collections.save({
			name: "clients",
			schema: {
				type: "object",
				properties: { client_name: { type: "string" } },
				required: ["client_name"],
				additionalProperties: false,
			},
			members: [
				{ id: "member_1", position: 0, data: { client_name: "Acme" } },
				{ id: "member_2", position: 1, data: { client_name: "Globex" } },
			],
		});
		const doc = makeDoc("poster");
		const page = doc.pages[0];
		if (page) page.collection = { name: "clients" };
		base.store.saveDoc(doc);
		base.documents.loadAll();
		return { ...base, handler, collectionCursors };
	}

	it("moves the cursor and defaults are page-scoped", () => {
		const { handler, collectionCursors, dispose } = cursorFixture();
		handler(
			{
				type: "collection_cursor_set",
				docName: "poster",
				pageIndex: 0,
				mode: "rendered",
				memberId: "member_2",
			},
			STUB_WS,
		);
		expect(collectionCursors.resolve("poster", 0)).toEqual(
			expect.objectContaining({ mode: "rendered", memberId: "member_2" }),
		);
		dispose();
	});

	it("rejects invalid modes and toasts on unknown rows", () => {
		const { bus, handler, collectionCursors, dispose } = cursorFixture();
		const toasts: string[] = [];
		bus.on("toast", ({ text }) => toasts.push(text));

		handler(
			{
				type: "collection_cursor_set",
				docName: "poster",
				pageIndex: 0,
				mode: "sideways",
			} as never,
			STUB_WS,
		);
		expect(collectionCursors.resolve("poster", 0)?.mode).toBe("template");

		handler(
			{
				type: "collection_cursor_set",
				docName: "poster",
				pageIndex: 0,
				memberId: "ghost",
			},
			STUB_WS,
		);
		expect(toasts.some((text) => text.includes('Row "ghost" not found'))).toBe(
			true,
		);
		dispose();
	});
});
