/**
 * ws-handler — browser WebSocket message processing.
 *
 * Built as a factory so the handler closes over injected services. The
 * returned function is what `index.ts` wires into `ws.on("message", ...)`.
 *
 * WARNING: doc.activePage / doc.currentPage reflects the SERVER's active
 * page, which may differ from what the browser client is viewing
 * (multi-page workspace). Always use msg.pageIndex from the client when
 * targeting a specific page.
 */

import type { WorkspaceCommand } from "@maket/shared";
import type WebSocket from "ws";
import { createCollectionCursors } from "../collection-cursor.js";
import { createCollections } from "../collections.js";
import { handleDeleteAsset, handleUpdateAssetMeta } from "./asset-commands.js";
import { handleCharteSave, handleUpdateCharteMeta } from "./charte-commands.js";
import {
	handleCollectionBindPage,
	handleCollectionClearPage,
	handleCollectionCursorSet,
	handleCollectionDelete,
	handleCollectionSave,
} from "./collection-commands.js";
import type {
	WorkspaceCommandHandler,
	WsHandlerContext,
	WsHandlerDeps,
} from "./context.js";
import {
	handleClearCanvas,
	handleDeleteDocument,
	handleDuplicateDocument,
	handleLoadDocument,
	handleLockDocument,
	handlePageGo,
	handleRenameDocument,
	handleSaveDocument,
	handleUpdateCanvas,
	handleUpdateMeta,
} from "./document-commands.js";
import {
	handleLayoutReport,
	handleOpenOnboarding,
	handleTextEdit,
	handleWorkspaceUpdate,
} from "./text-commands.js";

export type { WorkspaceCommandHandler, WsHandlerDeps } from "./context.js";

export function createWsHandler(deps: WsHandlerDeps): WorkspaceCommandHandler {
	const { assets, bus, documents, pending, store, wsBridge, wsRegistry } = deps;
	const collections =
		deps.collections ?? createCollections({ bus, documents, store });
	const collectionCursors =
		deps.collectionCursors ??
		createCollectionCursors({ bus, documents, store });
	const ctx: WsHandlerContext = {
		assets,
		bus,
		collections,
		collectionCursors,
		documents,
		pending,
		store,
		wsBridge,
		wsRegistry,
		wsDoc: (msg) => (msg.docName ? documents.resolve(msg.docName) : null),
		broadcastState: (d) => {
			if (!d) return;
			bus.emit("document:saved", { docName: d.name });
		},
	};

	return (msg, ws) => dispatchWorkspaceCommand(ctx, msg, ws);
}

function dispatchWorkspaceCommand(
	ctx: WsHandlerContext,
	msg: WorkspaceCommand,
	ws: WebSocket,
): void {
	switch (msg.type) {
		case "load_document":
			handleLoadDocument(ctx, msg, ws);
			break;
		case "sync_pending":
			ctx.pending.syncFromClient(msg.pending || []);
			break;
		case "workspace_update":
			handleWorkspaceUpdate(ctx, msg);
			break;
		case "layout_report":
			handleLayoutReport(ctx, msg);
			break;
		case "save_document":
			handleSaveDocument(ctx, msg);
			break;
		case "update_canvas":
			handleUpdateCanvas(ctx, msg);
			break;
		case "update_meta":
			handleUpdateMeta(ctx, msg);
			break;
		case "charte_save":
			handleCharteSave(ctx, msg);
			break;
		case "update_charte_meta":
			handleUpdateCharteMeta(ctx, msg);
			break;
		case "collection_save":
			handleCollectionSave(ctx, msg);
			break;
		case "collection_delete":
			handleCollectionDelete(ctx, msg);
			break;
		case "collection_bind_page":
			handleCollectionBindPage(ctx, msg);
			break;
		case "collection_clear_page":
			handleCollectionClearPage(ctx, msg);
			break;
		case "collection_cursor_set":
			handleCollectionCursorSet(ctx, msg);
			break;
		case "delete_asset":
			handleDeleteAsset(ctx, msg);
			break;
		case "update_asset_meta":
			handleUpdateAssetMeta(ctx, msg);
			break;
		case "page_go":
			handlePageGo(ctx, msg);
			break;
		case "clear_canvas":
			handleClearCanvas(ctx, msg);
			break;
		case "delete_document":
			handleDeleteDocument(ctx, msg);
			break;
		case "rename_document":
			handleRenameDocument(ctx, msg);
			break;
		case "duplicate_document":
			handleDuplicateDocument(ctx, msg);
			break;
		case "lock_document":
			handleLockDocument(ctx, msg);
			break;
		case "open_onboarding":
			handleOpenOnboarding(ctx, msg, ws);
			break;
		case "text_edit":
			handleTextEdit(ctx, msg);
			break;
		case "check_layout_response":
			if (msg._reqId) ctx.wsBridge.resolveResponse(msg._reqId, msg);
			break;
	}
}
