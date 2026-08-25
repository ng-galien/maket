/**
 * Collection-related workspace command handlers.
 */

import {
	type Collection,
	isCollectionCursorMode,
	type WorkspaceCommand,
} from "@maket/shared";
import { localizedOf } from "../../lib/message-error.js";
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
		emitFailure(ctx, error);
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
		emitFailure(ctx, error);
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
		emitFailure(ctx, error);
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
		emitFailure(ctx, error);
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
		emitFailure(ctx, error);
	}
}

/** Prefer the identifier the browser can translate; the raw sentence is the
 *  fallback for failures that do not carry one yet. */
function emitFailure(ctx: WsHandlerContext, error: unknown): void {
	const localized = localizedOf(error);
	if (localized) {
		ctx.bus.emit("toast", {
			key: localized.key,
			params: localized.params,
			level: "error",
		});
		return;
	}
	ctx.bus.emit("toast", {
		key: "toast_detail",
		params: { detail: error instanceof Error ? error.message : String(error) },
		level: "error",
	});
}
