import type { PendingMessage } from "@maket/shared";
import { describe, expect, it } from "vitest";
import { DocumentModel } from "../types.js";
import { createBus } from "./bus.js";
import type { Config } from "./config.js";
import { createDocuments } from "./documents.js";
import { createSQLiteStore } from "./store.js";
import { createWsBridge } from "./ws-bridge.js";
import { createWsHandler } from "./ws-handler.js";
import { createWsRegistry } from "./ws-registry.js";

function makeDoc(name: string) {
	return new DocumentModel({
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
	const wsRegistry = createWsRegistry();
	const wsBridge = createWsBridge({ wsRegistry });
	const config = { ASSETS_DIR: "/tmp/maket-test-assets" } as Config;
	const handler = createWsHandler({
		bus,
		config,
		documents,
		store,
		wsRegistry,
		wsBridge,
	});
	return {
		store,
		bus,
		documents,
		handler,
		cleanup: () => store.close(),
	};
}

// biome-ignore lint/suspicious/noExplicitAny: stub WebSocket is opaque to the handler
const STUB_WS: any = { readyState: 1, send() {} };

describe("ws-handler — sync_pending", () => {
	it("buckets entries by docName and replaces _pending on every loaded doc", () => {
		const { store, documents, handler, cleanup } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		store.saveDoc(makeDoc("c"));
		documents.loadAll();

		// Seed a stale _pending on doc "c" so we can prove it gets cleared.
		documents.resolve("c")!._pending = [
			{ id: "stale", docName: "c", type: "note" },
		];

		const pending: PendingMessage[] = [
			{ id: "1", docName: "a", type: "note", text: "fix this" },
			{ id: "2", docName: "a", type: "delete", elementId: "el-1" },
			{ id: "3", docName: "b", type: "drop-image", file: "x.png" },
		];

		handler({ type: "sync_pending", pending }, STUB_WS);

		expect(documents.resolve("a")?._pending).toEqual([
			{ id: "1", docName: "a", type: "note", text: "fix this" },
			{ id: "2", docName: "a", type: "delete", elementId: "el-1" },
		]);
		expect(documents.resolve("b")?._pending).toEqual([
			{ id: "3", docName: "b", type: "drop-image", file: "x.png" },
		]);
		// Unmentioned doc's stale pending must be wiped — client is authoritative.
		expect(documents.resolve("c")?._pending).toEqual([]);

		cleanup();
	});

	it("ignores entries without a docName", () => {
		const { store, documents, handler, cleanup } = fixture();
		store.saveDoc(makeDoc("a"));
		documents.loadAll();

		handler(
			{
				type: "sync_pending",
				pending: [
					{ id: "1", docName: "a", type: "note" },
					{ id: "2", type: "note" }, // no docName — must be dropped
				],
			},
			STUB_WS,
		);

		expect(documents.resolve("a")?._pending).toEqual([
			{ id: "1", docName: "a", type: "note" },
		]);

		cleanup();
	});

	it("empty pending clears every doc's _pending", () => {
		const { store, documents, handler, cleanup } = fixture();
		store.saveDoc(makeDoc("a"));
		store.saveDoc(makeDoc("b"));
		documents.loadAll();
		documents.resolve("a")!._pending = [
			{ id: "x", docName: "a", type: "note" },
		];
		documents.resolve("b")!._pending = [
			{ id: "y", docName: "b", type: "note" },
		];

		handler({ type: "sync_pending", pending: [] }, STUB_WS);

		expect(documents.resolve("a")?._pending).toEqual([]);
		expect(documents.resolve("b")?._pending).toEqual([]);

		cleanup();
	});
});
