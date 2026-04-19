/**
 * ws-bridge — request/response correlation over WebSocket.
 *
 * MCP tools broadcast a message tagged with a correlation id (a `_reqId` for
 * point-to-point RPCs, or a pre-computed `measureId` for broadcasts the
 * browser is expected to reply to). `resolveResponse` is called by the WS
 * handler when a tagged reply arrives; `sendRequest` / `waitForResponse`
 * return a promise that resolves with the reply or `null` on timeout.
 *
 * State is held in the service instance, not as module singletons — so tests
 * can build an isolated bridge with a stub `wsRegistry`.
 */

import crypto from "node:crypto";
import type { WsServerMessage } from "@maket/shared";
import type { WsRegistry } from "./ws-registry.js";

interface PendingRequest {
	resolve: (data: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
}

export interface WsBridge {
	/** Send a request to every connected client and wait for a correlated reply. */
	sendRequest(
		type: string,
		payload?: Record<string, unknown>,
		timeoutMs?: number,
	): Promise<unknown | null>;
	/** Wait for a reply tagged with a pre-computed correlation id (e.g. measureId). */
	waitForResponse(id: string, timeoutMs?: number): Promise<unknown | null>;
	/** Called by the WS handler when a tagged reply arrives. */
	resolveResponse(reqId: string, data: unknown): void;
}

export interface WsBridgeDeps {
	wsRegistry: WsRegistry;
}

export function createWsBridge({ wsRegistry }: WsBridgeDeps): WsBridge {
	const pending = new Map<string, PendingRequest>();

	function registerPending(
		id: string,
		timeoutMs: number,
	): Promise<unknown | null> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				resolve(null);
			}, timeoutMs);
			pending.set(id, { resolve, timer });
		});
	}

	return {
		sendRequest(type, payload = {}, timeoutMs = 2000) {
			const reqId = crypto.randomUUID();
			// Cast: sendRequest is the generic RPC primitive — the shared union lists
			// only the request types actually in use today (`check_layout_request`),
			// but the primitive itself is deliberately open so new tool-pack RPCs
			// don't require a shared contract edit to compile.
			wsRegistry.broadcast({
				type,
				_reqId: reqId,
				...payload,
			} as unknown as WsServerMessage);
			return registerPending(reqId, timeoutMs);
		},
		waitForResponse(id, timeoutMs = 3000) {
			return registerPending(id, timeoutMs);
		},
		resolveResponse(reqId, data) {
			const entry = pending.get(reqId);
			if (!entry) return;
			clearTimeout(entry.timer);
			pending.delete(reqId);
			entry.resolve(data);
		},
	};
}
