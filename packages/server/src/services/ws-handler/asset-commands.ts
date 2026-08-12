/**
 * Asset workspace command handlers.
 */

import type { WorkspaceCommand } from "@maket/shared";
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
