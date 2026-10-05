import type { WorkspaceCommand } from "@maket/shared";
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
