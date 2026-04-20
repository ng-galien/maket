import type { PendingMessage } from "@maket/shared";
import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../types.js";
import { createBus } from "./bus.js";
import type { Config } from "./config.js";
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
	const config = { ASSETS_DIR: "/tmp/maket-test-assets" } as Config;
	const handler = createWsHandler({
		bus,
		config,
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
		cleanup: () => store.close(),
	};
}

// biome-ignore lint/suspicious/noExplicitAny: stub WebSocket is opaque to the handler
const STUB_WS: any = { readyState: 1, send() {} };

describe("ws-handler — sync_pending", () => {
	it("delegates to the pending service which buckets per-doc and workspace", () => {
		const { store, documents, pending, handler, cleanup } = fixture();
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
		cleanup();
	});

	it("empty snapshot clears every bucket (workspace included)", () => {
		const { pending, handler, cleanup } = fixture();
		pending.syncFromClient([
			{ id: "a", docName: "doc-a", type: "note" },
			{ id: "w", type: "classify-images" },
		]);

		handler({ type: "sync_pending", pending: [] }, STUB_WS);

		expect(pending.forDoc("doc-a")).toEqual([]);
		expect(pending.forWorkspace()).toEqual([]);
		cleanup();
	});

	it("delete_document drops the deleted doc's pending bucket", () => {
		const { store, documents, pending, handler, cleanup } = fixture();
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
		cleanup();
	});
});

describe("ws-handler — lock guards", () => {
	it("refuses delete_document when the doc is locked", () => {
		const { store, bus, documents, handler, cleanup } = fixture();
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
		cleanup();
	});

	it("refuses rename_document when the doc is locked", () => {
		const { store, bus, documents, handler, cleanup } = fixture();
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
		cleanup();
	});

	it("refuses update_meta when the doc is locked", () => {
		const { store, bus, documents, handler, cleanup } = fixture();
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
		cleanup();
	});

	it("still allows lock_document to toggle a locked doc back to unlocked", () => {
		const { store, documents, handler, cleanup } = fixture();
		const locked = makeDoc("locked");
		locked.meta.locked = true;
		store.saveDoc(locked);
		documents.loadAll();

		handler({ type: "lock_document", name: "locked", locked: false }, STUB_WS);

		expect(documents.resolve("locked")?.meta.locked).toBe(false);
		cleanup();
	});
});
