/**
 * Asset workspace command handlers.
 */

import type { WorkspaceCommand } from "@maket/shared";
import type { WsHandlerContext } from "./context.js";
import { isStringArray } from "./context.js";

export function handleDeleteAsset(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "delete_asset" }>,
): void {
	if (!msg.filename) return;
	const filename = String(msg.filename);
	if (!ctx.assets.exists(filename)) return;
	ctx.assets.remove(filename);
	ctx.store.deleteAsset(filename);
	ctx.bus.emit("assets:changed", {});
}

export function handleUpdateAssetMeta(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "update_asset_meta" }>,
): void {
	const filename = String(msg.filename || "");
	if (!filename) return;
	if (!ctx.assets.exists(filename)) {
		ctx.bus.emit("toast", {
			text: `Asset "${filename}" not found`,
			level: "error",
		});
		return;
	}
	const invalid = validateAssetMetaPayload(msg);
	if (invalid) {
		ctx.bus.emit("toast", {
			text: `Asset "${filename}" rejected: ${invalid}`,
			level: "error",
		});
		return;
	}
	ctx.store.saveAsset({
		filename,
		title: msg.title,
		description: msg.description,
		category: msg.category,
		tags: msg.tags,
		credit: msg.credit,
		orientation: msg.orientation,
	});
	ctx.bus.emit("assets:changed", {});
}

function validateAssetMetaPayload(msg: {
	title?: unknown;
	description?: unknown;
	category?: unknown;
	tags?: unknown;
	credit?: unknown;
	orientation?: unknown;
}): string | null {
	for (const key of [
		"title",
		"description",
		"category",
		"credit",
		"orientation",
	] as const) {
		const v = msg[key];
		if (v !== undefined && typeof v !== "string")
			return `${key} must be a string`;
	}
	if (msg.tags !== undefined && !isStringArray(msg.tags))
		return "tags must be a string[]";
	return null;
}
