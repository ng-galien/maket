import type { Annotations } from "./services/annotations.js";
import type { Bus } from "./services/bus.js";
import type { CollectionCursors } from "./services/collection-cursor.js";
import type { Collections } from "./services/collections.js";
import type { DocumentRenderer } from "./services/document-renderer.js";
import type { Documents } from "./services/documents.js";
import type { MermaidDiagrams } from "./services/mermaid-diagrams.js";
import type { StructuredWorkspaces } from "./services/structured-workspaces.js";
import type { WsRegistry } from "./services/ws-registry.js";

export interface ServerEventDeps {
	bus: Bus;
	collections: Collections;
	collectionCursors: CollectionCursors;
	documents: Documents;
	documentRenderer: DocumentRenderer;
	mermaidDiagrams: MermaidDiagrams;
	structuredWorkspaces: StructuredWorkspaces;
	wsRegistry: WsRegistry;
	pending: Annotations;
}

type BroadcastDeps = Omit<ServerEventDeps, "bus" | "mermaidDiagrams">;

// State broadcasts deliberately assemble one wire snapshot from domain-owned services.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
function broadcastDoc(
	deps: BroadcastDeps,
	docName: string,
	addToWorkspace = false,
	focus = false,
): void {
	const {
		collections,
		collectionCursors,
		documents,
		documentRenderer,
		wsRegistry,
		pending,
	} = deps;
	const doc = documents.resolve(docName);
	if (!doc) return;
	wsRegistry.broadcast({
		type: "state",
		doc: documents.lightView(documentRenderer.render(doc), doc.activePage),
		documentState: documentRenderer.stateView(doc),
		docList: documents.list(),
		collections: collections.loadAll(),
		collectionCursors: collectionCursors.snapshot(),
		annotations: pending.all(),
		charteCss: documents.charteCss(doc),
		addToWorkspace,
		focus,
	});
}

// Rename broadcasts use the same authoritative snapshot plus the old identity.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
function broadcastRenamedDoc(
	deps: BroadcastDeps,
	oldName: string,
	docName: string,
): void {
	const {
		collections,
		collectionCursors,
		documents,
		documentRenderer,
		structuredWorkspaces,
		wsRegistry,
		pending,
	} = deps;
	const doc = documents.resolve(docName);
	if (!doc) return;
	wsRegistry.broadcast({
		type: "doc_renamed",
		oldName,
		doc: documents.lightView(documentRenderer.render(doc), doc.activePage),
		documentState: documentRenderer.stateView(doc),
		docList: documents.list(),
		collections: collections.loadAll(),
		structuredWorkspaces: structuredWorkspaces.listViews(),
		collectionCursors: collectionCursors.snapshot(),
		annotations: pending.all(),
		charteCss: documents.charteCss(doc),
	});
}

// This listener adapter is the intentional fan-out boundary between the bus and WebSocket clients.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function registerServerEvents(deps: ServerEventDeps): void {
	const {
		bus,
		collections,
		collectionCursors,
		documents,
		documentRenderer,
		mermaidDiagrams,
		structuredWorkspaces,
		wsRegistry,
		pending,
	} = deps;
	const broadcasters: BroadcastDeps = {
		collections,
		collectionCursors,
		documents,
		documentRenderer,
		structuredWorkspaces,
		wsRegistry,
		pending,
	};

	const loadEvents = ["document:created", "document:loaded"] as const;
	const mutationEvents = [
		"document:saved",
		"document:deleted",
		"canvas:changed",
		"element:updated",
	] as const;

	for (const event of loadEvents) {
		bus.on(event, ({ docName }) => broadcastDoc(broadcasters, docName, true));
	}
	for (const event of mutationEvents) {
		bus.on(event, ({ docName }) => broadcastDoc(broadcasters, docName));
	}
	bus.on("meta:updated", ({ docName }) => {
		mermaidDiagrams.refreshDocument(docName);
		broadcastDoc(broadcasters, docName);
	});
	bus.on("document:pinned", ({ docName, pinnedAt }) =>
		wsRegistry.broadcast({ type: "doc_pinned", name: docName, pinnedAt }),
	);
	bus.on("document:renamed", ({ oldName, docName }) =>
		broadcastRenamedDoc(broadcasters, oldName, docName),
	);
	bus.on("document-state:changed", ({ docName, paths, attached }) => {
		if (attached) {
			broadcastDoc(broadcasters, docName);
			return;
		}
		const doc = documents.resolve(docName);
		if (doc?.dataModel !== "state") return;
		const documentState = documentRenderer.stateView(doc);
		if (!documentState) return;
		const { restructured, ...update } = documentRenderer.statePages(doc, paths);
		if (restructured) {
			broadcastDoc(broadcasters, docName);
			return;
		}
		wsRegistry.broadcast({
			type: "state_pages",
			docName,
			documentState,
			...update,
			docList: documents.list(),
		});
	});
	bus.on("document:flowed", ({ docName }) =>
		broadcastDoc(broadcasters, docName),
	);
	bus.on("document:focused", ({ docName }) =>
		broadcastDoc(broadcasters, docName, true, true),
	);

	bus.on("workspace:fit-view", () =>
		wsRegistry.broadcast({ type: "fit_view" }),
	);
	bus.on("charte:updated", ({ name, css }) => {
		const refreshed = mermaidDiagrams.refreshCharte(name);
		for (const docName of refreshed.docNames) {
			bus.emit("element:updated", { docName, id: "html" });
		}
		wsRegistry.broadcast({ type: "charte_updated", name, css });
	});
	bus.on("charte:removed", ({ name }) => {
		const refreshed = mermaidDiagrams.refreshCharte(name);
		for (const docName of refreshed.docNames) {
			bus.emit("element:updated", { docName, id: "html" });
		}
		wsRegistry.broadcast({ type: "charte_removed", name });
	});

	const broadcastCollections = () => {
		wsRegistry.broadcast({
			type: "collections_changed",
			collections: collections.loadAll(),
		});
	};
	bus.on("collection:saved", broadcastCollections);
	bus.on("collection:deleted", broadcastCollections);
	bus.on("structured-workspace:changed", () => {
		wsRegistry.broadcast({
			type: "structured_workspaces_changed",
			workspaces: structuredWorkspaces.listViews(),
		});
	});
	bus.on("document-state:retention-changed", ({ docName, pruned }) => {
		wsRegistry.broadcast({
			type: "toast",
			key: "toast_state_revisions_pruned",
			params: { doc: docName, count: pruned },
			level: "info",
			duration: 3000,
		});
	});
	bus.on("structured-workspace:item-changed", ({ workspaceId, itemId }) => {
		const item = structuredWorkspaces.getItem(workspaceId, itemId);
		if (!item) return;
		wsRegistry.broadcast({
			type: "structured_workspace_item_changed",
			workspaceId,
			item,
		});
	});
	bus.on("collection-cursor:changed", () => {
		wsRegistry.broadcast({
			type: "collection_cursors",
			cursors: collectionCursors.snapshot(),
		});
	});

	bus.on("toast", ({ key, params, level, duration }) => {
		wsRegistry.broadcast({
			type: "toast",
			key,
			params,
			level: level ?? "info",
			duration: duration ?? 3000,
		});
	});
	bus.on("document:deleted", ({ docName }) => {
		wsRegistry.broadcast({ type: "doc_removed", name: docName });
		wsRegistry.broadcast({
			type: "annotations_changed",
			annotations: pending.all(),
		});
	});
	bus.on("messages:acked", ({ ids }) =>
		wsRegistry.broadcast({ type: "ack_messages", ids }),
	);
	bus.on("annotations:changed", () => {
		wsRegistry.broadcast({
			type: "annotations_changed",
			annotations: pending.all(),
		});
	});
	bus.on("assets:changed", ({ categoryUpdates }) =>
		wsRegistry.broadcast({ type: "assets_changed", categoryUpdates }),
	);
	bus.on("settings:changed", (settings) =>
		wsRegistry.broadcast({ type: "settings", settings }),
	);
}
