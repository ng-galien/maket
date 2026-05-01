import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PendingMessage } from "@maket/shared";
import { describe, expect, it, vi } from "vitest";
import { computeCanvasDims, createDocument } from "../types.js";
import { createAssetsService } from "./assets.js";
import { createBus } from "./bus.js";
import { createDocuments } from "./documents.js";
import { createPending } from "./pending.js";
import { createSQLiteStore } from "./store.js";
import { createWsBridge } from "./ws-bridge.js";
import { createWsHandler } from "./ws-handler.js";
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

function fixture() {
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const documents = createDocuments({ store });
	const pending = createPending({ bus });
	const wsRegistry = createWsRegistry();
	const wsBridge = createWsBridge({ wsRegistry });
	const assetsDir = mkdtempSync(join(tmpdir(), "maket-ws-assets-"));
	const assets = createAssetsService({ assetsDir });
	const handler = createWsHandler({
		assets,
		bus,
		documents,
		pending,
		store,
		wsRegistry,
		wsBridge,
	});
	return {
		store,
		bus,
		documents,
		pending,
		handler,
		wsBridge,
		wsRegistry,
		assetsDir,
		dispose: () => {
			store.close();
			rmSync(assetsDir, { recursive: true, force: true });
		},
	};
}

const STUB_WS: any = { readyState: 1, send() {} };

describe("ws-handler — sync_pending", () => {
	it("delegates to the pending service which buckets per-doc and workspace", () => {
		const { store, documents, pending, handler, dispose } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();

		// Seed stale state to prove the client snapshot is authoritative.
		pending.syncFromClient([
			{ id: "stale", docName: "a", type: "note" },
			{ id: "wstale", type: "classify-images" },
		]);

		const snapshot: PendingMessage[] = [
			{ id: "1", docName: "a", type: "note", text: "fix this" },
			{ id: "2", docName: "b", type: "drop-image", file: "x.png" },
			{ id: "3", type: "classify-images", text: "new images" },
		];

		handler({ type: "sync_pending", pending: snapshot }, STUB_WS);

		expect(pending.forDoc("a").map((m) => m.id)).toEqual(["1"]);
		expect(pending.forDoc("b").map((m) => m.id)).toEqual(["2"]);
		expect(pending.forWorkspace().map((m) => m.id)).toEqual(["3"]);
		dispose();
	});

	it("empty snapshot clears every bucket (workspace included)", () => {
		const { pending, handler, dispose } = fixture();
		pending.syncFromClient([
			{ id: "a", docName: "doc-a", type: "note" },
			{ id: "w", type: "classify-images" },
		]);

		handler({ type: "sync_pending", pending: [] }, STUB_WS);

		expect(pending.forDoc("doc-a")).toEqual([]);
		expect(pending.forWorkspace()).toEqual([]);
		dispose();
	});

	it("delete_document drops the deleted doc's pending bucket", () => {
		const { store, documents, pending, handler, dispose } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		pending.syncFromClient([
			{ id: "1", docName: "a", type: "note" },
			{ id: "2", docName: "b", type: "note" },
		]);

		handler({ type: "delete_document", name: "a" }, STUB_WS);

		expect(pending.forDoc("a")).toEqual([]);
		expect(pending.forDoc("b").map((m) => m.id)).toEqual(["2"]);
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

	it("layout_report stores layout data and resolves bridge responses", () => {
		const { store, documents, handler, wsBridge, dispose } = fixture();
		store.saveDoc(makeDoc("layout"));
		documents.loadAll();
		const resolveSpy = vi.spyOn(wsBridge, "resolveResponse");

		handler(
			{
				type: "layout_report",
				docName: "layout",
				measureId: "m-1",
				overflow: true,
				containerHeight: 100,
				contentHeight: 130,
				overflowBy: 30,
				overflowing: ["title"],
			},
			STUB_WS,
		);

		expect(documents.resolve("layout")?._layout).toEqual({
			overflow: true,
			containerHeight: 100,
			contentHeight: 130,
			overflowBy: 30,
			overflowing: ["title"],
		});
		expect(resolveSpy).toHaveBeenCalledWith(
			"m-1",
			expect.objectContaining({ type: "layout_report" }),
		);
		dispose();
	});

	it("save_document persists and emits save + toast events", () => {
		const { store, bus, documents, handler, dispose } = fixture();
		store.saveDoc(makeDoc("saved"));
		documents.loadAll();
		const saved = vi.fn();
		const toast = vi.fn();
		bus.on("document:saved", saved);
		bus.on("toast", toast);

		handler({ type: "save_document", docName: "saved" }, STUB_WS);

		expect(saved).toHaveBeenCalledWith({ docName: "saved" });
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringMatching(/saved/i) }),
		);
		expect(store.loadOne("saved")).not.toBeNull();
		dispose();
	});

	it("update_canvas recalculates dims and background", () => {
		const { store, documents, bus, handler, dispose } = fixture();
		store.saveDoc(makeDoc("poster"));
		documents.loadAll();
		const changed = vi.fn();
		bus.on("canvas:changed", changed);
		const next = computeCanvasDims("A5", "landscape");

		handler(
			{
				type: "update_canvas",
				docName: "poster",
				format: "A5",
				orientation: "landscape",
				bg: "#101010",
			},
			STUB_WS,
		);

		expect(documents.resolve("poster")?.canvas).toMatchObject({
			format: "A5",
			orientation: "landscape",
			bg: "#101010",
			w: next.w,
			h: next.h,
		});
		expect(changed).toHaveBeenCalledWith({ docName: "poster" });
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
				category: "social",
			},
			STUB_WS,
		);

		expect(documents.resolve("meta")).toMatchObject({
			category: "social",
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

	it("page_go switches the active page and clear_canvas resets the current page", () => {
		const { store, documents, bus, handler, dispose } = fixture();
		const doc = createDocument({
			name: "pages",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{ name: "P1", elements: [{ id: "a" }] },
				{ name: "P2", elements: [{ id: "b" }] },
			],
			nextId: 42,
		});
		store.saveDoc(doc);
		documents.loadAll();
		const loaded = vi.fn();
		const cleared = vi.fn();
		bus.on("document:loaded", loaded);
		bus.on("elements:cleared", cleared);

		handler({ type: "page_go", docName: "pages", page: 2 }, STUB_WS);
		handler({ type: "clear_canvas", docName: "pages" }, STUB_WS);

		expect(documents.resolve("pages")?.activePage).toBe(1);
		expect(documents.resolve("pages")?.pages[1]?.elements).toEqual([]);
		expect(documents.resolve("pages")?.nextId).toBe(1);
		expect(loaded).toHaveBeenCalledWith({ docName: "pages" });
		expect(cleared).toHaveBeenCalledWith({ docName: "pages" });
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

	it("rename_document succeeds and broadcasts removal of the old name", () => {
		const { store, documents, bus, wsRegistry, handler, dispose } = fixture();
		store.saveDoc(makeDoc("old"));
		documents.loadAll();
		const removed = vi.spyOn(wsRegistry, "broadcast");
		const toast = vi.fn();
		bus.on("toast", toast);

		handler({ type: "rename_document", name: "old", newName: "new" }, STUB_WS);

		expect(documents.resolve("old")).toBeNull();
		expect(documents.resolve("new")?.name).toBe("new");
		expect(removed).toHaveBeenCalledWith({ type: "doc_removed", name: "old" });
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
			{ name: "P1", elements: [{ id: "a" }], html: '<p data-id="a">A</p>' },
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
	it("updates the targeted page html, strips active content, and broadcasts state", () => {
		const { store, documents, wsRegistry, handler, dispose } = fixture();
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
		const broadcast = vi.spyOn(wsRegistry, "broadcast");

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
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "state",
				doc: expect.objectContaining({ name: "editor" }),
			}),
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
		const css = (updates.mock.calls[0]?.[0] as { css: string }).css;
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
	])("charte_save rejects malformed payload (%s) without persisting", (_, extra) => {
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
	});

	it("update_charte_meta merges fields into an existing charte without wiping omitted ones", () => {
		const { store, bus, handler, dispose } = fixture();
		store.saveCharte({
			name: "brand",
			description: "v1 desc",
			tokens: { color: { primary: "#2563EB" } },
			voice: { personality: ["bold"] },
		});
		const updates = vi.fn();
		bus.on("charte:updated", updates);

		handler(
			{
				type: "update_charte_meta",
				name: "brand",
				description: "v2 desc",
				rules: { titles: "sentence case" },
			},
			STUB_WS,
		);

		const stored = store.loadCharte("brand");
		// Updated fields written.
		expect(stored?.description).toBe("v2 desc");
		expect(stored?.rules?.titles).toBe("sentence case");
		// Omitted fields preserved.
		expect(stored?.tokens.color?.primary).toBe("#2563EB");
		expect(stored?.voice?.personality).toEqual(["bold"]);
		// Wire emits the recomposed CSS so clients reload tokens/fonts.
		expect(updates).toHaveBeenCalledWith(
			expect.objectContaining({ name: "brand" }),
		);
		dispose();
	});

	it("update_charte_meta toasts when the charte does not exist (no creation)", () => {
		const { store, bus, handler, dispose } = fixture();
		const toast = vi.fn();
		const updates = vi.fn();
		bus.on("toast", toast);
		bus.on("charte:updated", updates);

		handler(
			{
				type: "update_charte_meta",
				name: "nope",
				description: "ghost",
			},
			STUB_WS,
		);

		expect(store.loadCharte("nope")).toBeNull();
		expect(updates).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ level: "error" }),
		);
		dispose();
	});

	it("update_charte_meta rejects malformed tokens without persisting", () => {
		const { store, bus, handler, dispose } = fixture();
		store.saveCharte({
			name: "brand",
			tokens: { color: { primary: "#2563EB" } },
		});
		const updates = vi.fn();
		const toast = vi.fn();
		bus.on("charte:updated", updates);
		bus.on("toast", toast);

		handler(
			{
				type: "update_charte_meta",
				name: "brand",
				tokens: "oops" as unknown,
			} as any,
			STUB_WS,
		);

		// Existing charte left intact.
		expect(store.loadCharte("brand")?.tokens.color?.primary).toBe("#2563EB");
		expect(updates).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ level: "error" }),
		);
		dispose();
	});

	it("update_asset_meta merges fields into an existing asset row without wiping omitted ones", () => {
		const { store, bus, assetsDir, handler, dispose } = fixture();
		writeFileSync(join(assetsDir, "hero.png"), "px");
		store.saveAsset({
			filename: "hero.png",
			title: "Old title",
			description: "Old desc",
			tags: ["a", "b"],
		});
		const changed = vi.fn();
		bus.on("assets:changed", changed);

		handler(
			{
				type: "update_asset_meta",
				filename: "hero.png",
				title: "New title",
				credit: "@photographer",
			},
			STUB_WS,
		);

		const row = store.loadAsset("hero.png");
		expect(row?.title).toBe("New title");
		expect(row?.credit).toBe("@photographer");
		// Omitted fields preserved by the COALESCE upsert.
		expect(row?.description).toBe("Old desc");
		expect(row?.tags).toEqual(["a", "b"]);
		expect(changed).toHaveBeenCalledWith({});
		dispose();
	});

	it.each([
		["title as number", { title: 42 as unknown }],
		["tags as string", { tags: "oops" as unknown }],
		["tags non-string element", { tags: [1, 2] as unknown }],
		["credit as object", { credit: { x: 1 } as unknown }],
	])("update_asset_meta rejects malformed payload (%s) without persisting", (_, extra) => {
		const { store, bus, assetsDir, handler, dispose } = fixture();
		writeFileSync(join(assetsDir, "hero.png"), "px");
		store.saveAsset({ filename: "hero.png", title: "kept" });
		const toast = vi.fn();
		const changed = vi.fn();
		bus.on("toast", toast);
		bus.on("assets:changed", changed);

		handler(
			{
				type: "update_asset_meta",
				filename: "hero.png",
				...extra,
			} as any,
			STUB_WS,
		);

		// Existing row left intact.
		expect(store.loadAsset("hero.png")?.title).toBe("kept");
		expect(changed).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ level: "error" }),
		);
		dispose();
	});

	it("update_asset_meta toasts when the file is missing (no row creation)", () => {
		const { store, bus, handler, dispose } = fixture();
		const toast = vi.fn();
		const changed = vi.fn();
		bus.on("toast", toast);
		bus.on("assets:changed", changed);

		handler(
			{
				type: "update_asset_meta",
				filename: "missing.png",
				title: "Ghost",
			},
			STUB_WS,
		);

		expect(store.loadAsset("missing.png")).toBeNull();
		expect(changed).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ level: "error" }),
		);
		dispose();
	});

	it("check_layout_response resolves pending bridge requests", () => {
		const { handler, wsBridge, dispose } = fixture();
		const resolveSpy = vi.spyOn(wsBridge, "resolveResponse");

		handler(
			{ type: "check_layout_response", _reqId: "req-1", overflow: false },
			STUB_WS,
		);

		expect(resolveSpy).toHaveBeenCalledWith(
			"req-1",
			expect.objectContaining({ type: "check_layout_response" }),
		);
		dispose();
	});
});
