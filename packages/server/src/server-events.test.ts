import { describe, expect, it, vi } from "vitest";
import { registerServerEvents } from "./server-events.js";
import { createBus } from "./services/bus.js";

describe("server Mermaid refresh propagation", () => {
	it("refreshes durable diagrams before broadcasting a charte update", () => {
		const bus = createBus();
		const refreshCharte = vi.fn(() => ({ docNames: ["doc"], errors: [] }));
		const broadcast = vi.fn();
		const elementUpdated = vi.fn();
		bus.on("element:updated", elementUpdated);
		registerServerEvents({
			bus,
			collections: { loadAll: () => [] } as never,
			collectionCursors: { snapshot: () => [] } as never,
			documents: { resolve: () => null } as never,
			documentRenderer: {} as never,
			mermaidDiagrams: {
				refreshCharte,
				refreshDocument: vi.fn(() => ({ docNames: [], errors: [] })),
			},
			wsRegistry: { broadcast } as never,
			pending: { all: () => [] } as never,
		});

		bus.emit("charte:updated", { name: "brand", css: ":root {}" });

		expect(refreshCharte).toHaveBeenCalledWith("brand");
		expect(elementUpdated).toHaveBeenCalledWith({ docName: "doc", id: "html" });
		expect(broadcast).toHaveBeenCalledWith({
			type: "charte_updated",
			name: "brand",
			css: ":root {}",
		});
	});

	it("refreshes a document diagram before broadcasting changed metadata", () => {
		const bus = createBus();
		const order: string[] = [];
		const refreshDocument = vi.fn(() => {
			order.push("refresh");
			return { docNames: ["doc"], errors: [] };
		});
		const broadcast = vi.fn(() => order.push("broadcast"));
		registerServerEvents({
			bus,
			collections: { loadAll: () => [] } as never,
			collectionCursors: { snapshot: () => [] } as never,
			documents: {
				resolve: () => ({ name: "doc", pages: [], meta: {} }),
				lightView: (doc: unknown) => doc,
				list: () => [],
				charteCss: () => "",
			} as never,
			documentRenderer: {
				render: (doc: unknown) => doc,
				stateView: () => null,
			} as never,
			mermaidDiagrams: {
				refreshCharte: vi.fn(() => ({ docNames: [], errors: [] })),
				refreshDocument,
			},
			wsRegistry: { broadcast } as never,
			pending: { all: () => [] } as never,
		});

		bus.emit("meta:updated", { docName: "doc" });

		expect(refreshDocument).toHaveBeenCalledWith("doc");
		expect(order).toEqual(["refresh", "broadcast"]);
	});
});
