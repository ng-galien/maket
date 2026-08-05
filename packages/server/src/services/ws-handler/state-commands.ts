import type { WorkspaceCommand, WorkspaceSignal } from "@maket/shared";
import type WebSocket from "ws";
import type { WsHandlerContext } from "./context.js";

export function handleStatePatch(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "state_patch" }>,
	ws: WebSocket,
): void {
	const doc = ctx.documents.resolveOrLoad(msg.docName);
	if (!doc) {
		sendResult(ws, msg.requestId, false, undefined, "Document not found.");
		return;
	}
	if (doc.meta?.locked === true) {
		ctx.broadcastState(doc);
		sendResult(
			ws,
			msg.requestId,
			false,
			undefined,
			`Document "${doc.name}" is locked.`,
		);
		return;
	}
	try {
		const revision = ctx.documentStates.patchTerminal(
			msg.docName,
			msg.expectedRevision,
			msg.operation,
		);
		sendResult(ws, msg.requestId, true, revision.revision);
	} catch (error) {
		ctx.broadcastState(doc);
		sendResult(
			ws,
			msg.requestId,
			false,
			undefined,
			error instanceof Error ? error.message : String(error),
		);
	}
}

function sendResult(
	ws: WebSocket,
	requestId: string,
	ok: boolean,
	revision?: number,
	error?: string,
): void {
	const signal: Extract<WorkspaceSignal, { type: "state_patch_result" }> = {
		type: "state_patch_result",
		requestId,
		ok,
		revision,
		error,
	};
	ws.send(JSON.stringify(signal));
}
