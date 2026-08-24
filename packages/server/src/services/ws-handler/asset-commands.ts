/**
 * Asset workspace command handlers.
 */

import { normalizeCategoryPath, type WorkspaceCommand } from "@maket/shared";
import type { WsHandlerContext } from "./context.js";

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

export function handleUpdateAssetCategory(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "update_asset_category" }>,
): void {
	if (!ctx.assets.exists(msg.filename)) return;
	const category = normalizeCategoryPath(msg.category);
	const current = ctx.store.loadAsset(msg.filename);
	if (normalizeCategoryPath(current?.category) === category) return;
	ctx.store.saveAsset({ filename: msg.filename, category });
	ctx.bus.emit("assets:changed", {
		categoryUpdates: [{ filename: msg.filename, category }],
	});
}

export function handleMoveAssetCategory(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "move_asset_category" }>,
): void {
	const source = normalizeCategoryPath(msg.source);
	const destination = normalizeCategoryPath(msg.destination);
	if (!source || source === destination) return;
	if (destination.startsWith(`${source}/`)) {
		ctx.bus.emit("toast", {
			text: "An image category cannot be moved inside itself",
			level: "error",
		});
		return;
	}

	const affected = ctx.store
		.loadAllAssets()
		.filter(
			(asset) =>
				asset.category === source || asset.category?.startsWith(`${source}/`),
		);
	if (affected.length === 0) return;
	const categoryUpdates = affected.map((asset) => {
		const category = asset.category ?? "";
		const suffix = category.slice(source.length);
		const nextCategory = `${destination}${suffix}`;
		return { filename: asset.filename, category: nextCategory };
	});
	ctx.store.saveAssets(categoryUpdates);
	ctx.bus.emit("assets:changed", { categoryUpdates });
}
