import type { WorkspaceCommand } from "@maket/shared";
import { isItemSourceError } from "../item-sources/item-source-error.js";
import type { WsHandlerContext } from "./context.js";

export function handleRenameStructuredWorkspace(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "rename_structured_workspace" }>,
): void {
	try {
		ctx.structuredWorkspaces.rename(
			msg.workspaceId,
			msg.newName,
			msg.expectedRevision,
		);
	} catch (error) {
		ctx.bus.emit("toast", {
			key: "toast_detail",
			params: {
				detail: error instanceof Error ? error.message : String(error),
			},
			level: "error",
		});
	}
}

/** A new query replaces the collection window, the window's cursor extends
 * it; the listeners broadcast the window to every client. */
export function handleStructuredCollectionQuery(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "structured_collection_query" }>,
): void {
	try {
		ctx.itemWindows.query(msg.workspaceId, msg.collectionId, {
			...(msg.text === undefined ? {} : { text: msg.text }),
			...(msg.filters === undefined ? {} : { filters: msg.filters }),
			...(msg.cursor === undefined ? {} : { cursor: msg.cursor }),
		});
	} catch (error) {
		if (isItemSourceError(error)) {
			ctx.bus.emit("toast", {
				key: "toast_structured_query_refused",
				params: { code: error.code, detail: error.message },
				level: "error",
			});
			return;
		}
		ctx.bus.emit("toast", {
			key: "toast_detail",
			params: {
				detail: error instanceof Error ? error.message : String(error),
			},
			level: "error",
		});
	}
}

export function handleDeleteStructuredWorkspace(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "delete_structured_workspace" }>,
): void {
	try {
		ctx.structuredWorkspaces.delete(msg.workspaceId);
	} catch (error) {
		ctx.bus.emit("toast", {
			key: "toast_detail",
			params: {
				detail: error instanceof Error ? error.message : String(error),
			},
			level: "error",
		});
	}
}
