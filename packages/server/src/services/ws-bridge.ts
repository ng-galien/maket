/**
 * ws-bridge — request/response correlation over WebSocket.
 *
 * Emits `workspace:client-request` on the bus (with a correlation id); edge
 * listeners in `index.ts` fan that out via `wsRegistry.broadcast`. Replies
 * arrive through `resolveResponse` when the WS handler sees a tagged response.
 */

import crypto from "node:crypto";
import type { LayoutCheckRequestDraft } from "@maket/shared";
import type { Bus } from "./bus.js";

interface PendingRequest {
	resolve: (data: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
}

export interface WsBridge {
	/** Send a request to every connected client and wait for a correlated reply. */
	sendRequest(
		request: LayoutCheckRequestDraft,
		timeoutMs?: number,
	): Promise<unknown | null>;
	/** Wait for a reply tagged with a pre-computed correlation id (e.g. measureId). */
	waitForResponse(id: string, timeoutMs?: number): Promise<unknown | null>;
	/** Called by the WS handler when a tagged reply arrives. */
	resolveResponse(reqId: string, data: unknown): void;
}

export interface WsBridgeDeps {
	bus: Bus;
}

export function createWsBridge({ bus }: WsBridgeDeps): WsBridge {
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
		sendRequest(request, timeoutMs = 2000) {
			const reqId = crypto.randomUUID();
			bus.emit("workspace:client-request", {
				...request,
				_reqId: reqId,
			});
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
