import type {
	LocalizedMessage,
	WorkspaceCommand,
	WorkspaceSignal,
} from "@maket/shared";
import type WebSocket from "ws";
import { localizedOf } from "../../lib/message-error.js";
import type { WsHandlerContext } from "./context.js";

export function handleStatePatch(
	ctx: WsHandlerContext,
	msg: Extract<WorkspaceCommand, { type: "state_patch" }>,
	ws: WebSocket,
): void {
	const doc = ctx.documents.resolveOrLoad(msg.docName);
	if (!doc) {
		sendResult(ws, msg.requestId, false, undefined, {
			key: "msg_document_not_found",
			params: { name: msg.docName },
		});
		return;
	}
	if (doc.meta?.locked === true) {
		ctx.broadcastState(doc);
		sendResult(ws, msg.requestId, false, undefined, {
			key: "msg_document_locked",
			params: { name: doc.name },
		});
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
			localizedOf(error),
			error instanceof Error ? error.message : String(error),
		);
	}
}

function sendResult(
	ws: WebSocket,
	requestId: string,
	ok: boolean,
	revision?: number,
	message?: LocalizedMessage,
	error?: string,
): void {
	const signal: Extract<WorkspaceSignal, { type: "state_patch_result" }> = {
		type: "state_patch_result",
		requestId,
		ok,
		revision,
		message,
		error,
	};
	ws.send(JSON.stringify(signal));
}
