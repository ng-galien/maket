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

import type { ConnectionCheckedSignal, WorkspaceCommand } from "@maket/shared";
import type WebSocket from "ws";
import { localizedOf } from "../../lib/message-error.js";
import { createCollectionCursors } from "../collection-cursor.js";
import { createCollections } from "../collections.js";
import {
	handleDeleteAsset,
	handleMoveAssetCategory,
	handleUpdateAssetCategory,
} from "./asset-commands.js";
import { handleCharteSave } from "./charte-commands.js";
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
	handleDeleteDocument,
	handleDuplicateDocument,
	handleLoadDocument,
	handleLockDocument,
	handleMoveCategory,
	handlePinDocument,
	handleRenameDocument,
	handleUpdateMeta,
} from "./document-commands.js";
import { handleStatePatch } from "./state-commands.js";
import {
	handleDeleteStructuredWorkspace,
	handleRenameStructuredWorkspace,
	handleStructuredCollectionQuery,
} from "./structured-workspace-commands.js";
import {
	handleOpenOnboarding,
	handleTextEdit,
	handleWorkspaceUpdate,
} from "./text-commands.js";

export type { WorkspaceCommandHandler, WsHandlerDeps } from "./context.js";

export function createWsHandler(deps: WsHandlerDeps): WorkspaceCommandHandler {
	const {
		assets,
		bus,
		documentRenderer,
		documentStateMutations,
		documentStates,
		documents,
		itemWindows,
		pending,
		settings,
		store,
		structuredWorkspaces,
		wsRegistry,
	} = deps;
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
		documentRenderer,
		documentStateMutations,
		documentStates,
		documents,
		itemWindows,
		pending,
		settings,
		store,
		structuredWorkspaces,
		wsRegistry,
		wsDoc: (msg) => (msg.docName ? documents.resolveOrLoad(msg.docName) : null),
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
	if (ctx.wsRegistry.isViewer(ws) && msg.type !== "load_document") return;
	switch (msg.type) {
		case "load_document":
			handleLoadDocument(ctx, msg, ws);
			break;
		case "annotation_create":
			handleAnnotationCreate(ctx, msg, ws);
			break;
		case "annotation_remove":
			handleAnnotationRemove(ctx, msg);
			break;
		case "annotation_edit":
			handleAnnotationEdit(ctx, msg, ws);
			break;
		case "workspace_update":
			handleWorkspaceUpdate(ctx, msg);
			break;
		case "settings_set":
			ctx.settings.patch(msg.settings);
			break;
		case "connection_check":
			ws.send(
				JSON.stringify({
					type: "connection_checked",
					requestId: msg.requestId,
				} satisfies ConnectionCheckedSignal),
			);
			break;
		case "update_meta":
			handleUpdateMeta(ctx, msg);
			break;
		case "move_category":
			handleMoveCategory(ctx, msg);
			break;
		case "charte_save":
			handleCharteSave(ctx, msg);
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
		case "update_asset_category":
			handleUpdateAssetCategory(ctx, msg);
			break;
		case "move_asset_category":
			handleMoveAssetCategory(ctx, msg);
			break;
		case "delete_document":
			handleDeleteDocument(ctx, msg);
			break;
		case "rename_document":
			handleRenameDocument(ctx, msg);
			break;
		case "rename_structured_workspace":
			handleRenameStructuredWorkspace(ctx, msg);
			break;
		case "delete_structured_workspace":
			handleDeleteStructuredWorkspace(ctx, msg);
			break;
		case "structured_collection_query":
			handleStructuredCollectionQuery(ctx, msg);
			break;
		case "duplicate_document":
			handleDuplicateDocument(ctx, msg);
			break;
		case "lock_document":
			handleLockDocument(ctx, msg);
			break;
		case "pin_document":
			handlePinDocument(ctx, msg);
			break;
		case "open_onboarding":
			handleOpenOnboarding(ctx, msg, ws);
			break;
		case "text_edit":
			handleTextEdit(ctx, msg);
			break;
		case "state_patch":
			handleStatePatch(ctx, msg, ws);
			break;
	}
}

function handleAnnotationCreate(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "annotation_create" }>,
	ws: WebSocket,
): void {
	try {
		ctx.pending.create(msg.annotation);
		ws.send(
			JSON.stringify({
				type: "annotation_create_result",
				requestId: msg.requestId,
				ok: true,
			}),
		);
		ctx.bus.emit("toast", { key: "toast_message_sent", level: "success" });
	} catch (error) {
		ws.send(
			JSON.stringify({
				type: "annotation_create_result",
				requestId: msg.requestId,
				ok: false,
				message: localizedOf(error) ?? { key: "msg_annotation_not_saved" },
			}),
		);
	}
}

function handleAnnotationRemove(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "annotation_remove" }>,
): void {
	const { matched } = ctx.pending.ack([msg.id]);
	if (matched.length > 0)
		ctx.bus.emit("toast", { key: "toast_message_deleted", level: "info" });
}

function handleAnnotationEdit(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "annotation_edit" }>,
	ws: WebSocket,
): void {
	try {
		ctx.pending.edit(msg.id, msg.text);
		ws.send(
			JSON.stringify({
				type: "annotation_edit_result",
				requestId: msg.requestId,
				ok: true,
			}),
		);
		ctx.bus.emit("toast", { key: "toast_message_edited", level: "success" });
	} catch (error) {
		ws.send(
			JSON.stringify({
				type: "annotation_edit_result",
				requestId: msg.requestId,
				ok: false,
				message: localizedOf(error) ?? { key: "msg_annotation_not_saved" },
			}),
		);
	}
}
