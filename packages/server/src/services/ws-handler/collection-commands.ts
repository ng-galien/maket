/**
 * Collection-related workspace command handlers.
 */

import {
	type Collection,
	isCollectionCursorMode,
	type WorkspaceCommand,
} from "@maket/shared";
import type { WsHandlerContext } from "./context.js";
import { isPlainObject } from "./context.js";

export function handleCollectionSave(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "collection_save" }>,
): void {
	if (!isPlainObject(msg.collection)) {
		ctx.bus.emit("toast", {
			key: "toast_collection_payload_invalid",
			level: "error",
		});
		return;
	}
	try {
		ctx.collections.save(msg.collection as unknown as Collection);
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

export function handleCollectionDelete(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "collection_delete" }>,
): void {
	if (!msg.name) return;
	try {
		ctx.collections.delete(msg.name);
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

export function handleCollectionBindPage(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "collection_bind_page" }>,
): void {
	try {
		const doc = ctx.collections.bindPage(
			msg.docName,
			msg.pageIndex,
			msg.collectionName,
		);
		ctx.broadcastState(doc);
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

export function handleCollectionClearPage(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "collection_clear_page" }>,
): void {
	try {
		const doc = ctx.collections.clearPageBinding(msg.docName, msg.pageIndex);
		ctx.broadcastState(doc);
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

export function handleCollectionCursorSet(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "collection_cursor_set" }>,
): void {
	if (msg.mode !== undefined && !isCollectionCursorMode(msg.mode)) return;
	try {
		ctx.collectionCursors.set(msg.docName, msg.pageIndex, {
			mode: msg.mode,
			memberId: msg.memberId,
		});
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
