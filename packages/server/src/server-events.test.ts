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
			documents: { resolve: () => null, all: () => new Map() } as never,
			documentRenderer: {} as never,
			itemWindows: {} as never,
			mermaidDiagrams: {
				refreshCharte,
				refreshDocument: vi.fn(() => ({ docNames: [], errors: [] })),
			},
			structuredWorkspaces: { listViews: () => [] } as never,
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

	it("sends again a state document whose render slot follows the updated charte", () => {
		const bus = createBus();
		const broadcast = vi.fn();
		const slotDoc = {
			name: "flow",
			dataModel: "state",
			meta: { charte: "brand" },
			pages: [
				{
					html: '<div data-maket-render="mermaid" data-maket-from="state.flow"></div>',
				},
			],
		};
		const otherDoc = {
			name: "other",
			dataModel: "state",
			meta: { charte: "brand" },
			pages: [{ html: "<p>{{state.title}}</p>" }],
		};
		const render = vi.fn((doc: unknown) => doc);
		registerServerEvents({
			bus,
			collections: { loadAll: () => [] } as never,
			collectionCursors: { snapshot: () => [] } as never,
			documents: {
				all: () =>
					new Map([
						["flow", slotDoc],
						["other", otherDoc],
					]),
				resolve: (name: string) => (name === "flow" ? slotDoc : otherDoc),
				lightView: (doc: unknown) => doc,
				list: () => [],
				charteCss: () => "",
			} as never,
			documentRenderer: { render, stateView: () => null } as never,
			itemWindows: {} as never,
			mermaidDiagrams: {
				refreshCharte: vi.fn(() => ({ docNames: [], errors: [] })),
				refreshDocument: vi.fn(() => ({ docNames: [], errors: [] })),
			},
			structuredWorkspaces: { listViews: () => [] } as never,
			wsRegistry: { broadcast } as never,
			pending: { all: () => [] } as never,
		});

		bus.emit("charte:updated", { name: "brand", css: ":root {}" });

		expect(render).toHaveBeenCalledTimes(1);
		expect(render).toHaveBeenCalledWith(slotDoc);
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({ type: "state", doc: slotDoc }),
		);
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
			itemWindows: {} as never,
			mermaidDiagrams: {
				refreshCharte: vi.fn(() => ({ docNames: [], errors: [] })),
				refreshDocument,
			},
			structuredWorkspaces: { listViews: () => [] } as never,
			wsRegistry: { broadcast } as never,
			pending: { all: () => [] } as never,
		});

		bus.emit("meta:updated", { docName: "doc" });

		expect(refreshDocument).toHaveBeenCalledWith("doc");
		expect(order).toEqual(["refresh", "broadcast"]);
	});
});

describe("server document-state retention notice", () => {
	it("tells the user how many revisions a retention deleted", () => {
		const bus = createBus();
		const broadcast = vi.fn();
		registerServerEvents({
			bus,
			collections: { loadAll: () => [] } as never,
			collectionCursors: { snapshot: () => [] } as never,
			documents: { resolve: () => null } as never,
			documentRenderer: {} as never,
			itemWindows: {} as never,
			mermaidDiagrams: {
				refreshCharte: vi.fn(() => ({ docNames: [], errors: [] })),
				refreshDocument: vi.fn(() => ({ docNames: [], errors: [] })),
			},
			structuredWorkspaces: { listViews: () => [] } as never,
			wsRegistry: { broadcast } as never,
			pending: { all: () => [] } as never,
		});

		bus.emit("document-state:retention-changed", {
			docName: "Board",
			retention: 0,
			pruned: 12,
		});

		expect(broadcast).toHaveBeenCalledWith({
			type: "toast",
			key: "toast_state_revisions_pruned",
			params: { doc: "Board", count: 12 },
			level: "info",
			duration: 3000,
		});
	});
});

describe("server Structured Workspace propagation", () => {
	it("broadcasts the authoritative workspace views after a domain change", () => {
		const bus = createBus();
		const broadcast = vi.fn();
		const workspaces = [{ id: "delivery", name: "Delivery" }];
		registerServerEvents({
			bus,
			collections: { loadAll: () => [] } as never,
			collectionCursors: { snapshot: () => [] } as never,
			documents: { resolve: () => null } as never,
			documentRenderer: {} as never,
			itemWindows: {} as never,
			mermaidDiagrams: {
				refreshCharte: vi.fn(() => ({ docNames: [], errors: [] })),
				refreshDocument: vi.fn(() => ({ docNames: [], errors: [] })),
			},
			structuredWorkspaces: { listViews: () => workspaces } as never,
			wsRegistry: { broadcast } as never,
			pending: { all: () => [] } as never,
		});

		bus.emit("structured-workspace:changed", { workspaceId: "delivery" });

		expect(broadcast).toHaveBeenCalledWith({
			type: "structured_workspaces_changed",
			workspaces,
		});
	});

	it("broadcasts the collection window and the index pages after a window change", () => {
		const bus = createBus();
		const broadcast = vi.fn();
		const listViews = vi.fn(() => []);
		const window = {
			workspaceId: "delivery",
			collectionId: "tasks",
			query: {},
			items: [],
			total: 0,
			fetchedAt: "2026-10-13T20:00:00.000Z",
		};
		const current = vi.fn(() => window);
		const index = {
			name: "Delivery — Tasks",
			dataModel: "state",
			meta: {
				structuredWorkspace: {
					role: "collection",
					workspaceId: "delivery",
					collectionId: "tasks",
				},
			},
			pages: [],
		};
		const documentState = { revision: 1, data: {} };
		registerServerEvents({
			bus,
			collections: { loadAll: () => [] } as never,
			collectionCursors: { snapshot: () => [] } as never,
			documents: {
				resolve: (name: string) => (name === index.name ? index : null),
				all: () => new Map([[index.name, index]]),
				list: () => [],
			} as never,
			documentRenderer: {
				stateView: () => documentState,
				statePages: () => ({
					pages: [{ index: 0, id: "p", html: "<main></main>" }],
					pageCount: 1,
				}),
			} as never,
			itemWindows: { current },
			mermaidDiagrams: {
				refreshCharte: vi.fn(() => ({ docNames: [], errors: [] })),
				refreshDocument: vi.fn(() => ({ docNames: [], errors: [] })),
			},
			structuredWorkspaces: { listViews } as never,
			wsRegistry: { broadcast } as never,
			pending: { all: () => [] } as never,
		});

		bus.emit("structured-workspace:window-changed", {
			workspaceId: "delivery",
			collectionId: "tasks",
		});

		expect(current).toHaveBeenCalledWith("delivery", "tasks");
		expect(broadcast.mock.calls.map(([message]) => message)).toEqual([
			{ type: "structured_collection_window", window },
			{
				type: "state_pages",
				docName: "Delivery — Tasks",
				documentState,
				pages: [{ index: 0, id: "p", html: "<main></main>" }],
				pageCount: 1,
				docList: [],
			},
		]);
		expect(listViews).not.toHaveBeenCalled();
	});
});

describe("server document pin propagation", () => {
	it("broadcasts a pin change as one document list update", () => {
		const bus = createBus();
		const broadcast = vi.fn();
		registerServerEvents({
			bus,
			collections: { loadAll: () => [] } as never,
			collectionCursors: { snapshot: () => [] } as never,
			documents: { resolve: () => null } as never,
			documentRenderer: {} as never,
			itemWindows: {} as never,
			mermaidDiagrams: {
				refreshCharte: vi.fn(() => ({ docNames: [], errors: [] })),
				refreshDocument: vi.fn(() => ({ docNames: [], errors: [] })),
			},
			structuredWorkspaces: { listViews: () => [] } as never,
			wsRegistry: { broadcast } as never,
			pending: { all: () => [] } as never,
		});

		bus.emit("document:pinned", {
			docName: "synthesis",
			pinnedAt: "2026-10-10T08:00:00.000Z",
		});
		bus.emit("document:pinned", { docName: "synthesis", pinnedAt: null });

		expect(broadcast.mock.calls).toEqual([
			[
				{
					type: "doc_pinned",
					name: "synthesis",
					pinnedAt: "2026-10-10T08:00:00.000Z",
				},
			],
			[{ type: "doc_pinned", name: "synthesis", pinnedAt: null }],
		]);
	});
});
