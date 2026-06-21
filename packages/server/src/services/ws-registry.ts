/**
 * ws-registry — WebSocket client management (transport-layer only).
 *
 * Exposes an abstract `WsLike` shape so tests can use plain objects with
 * `readyState` + `send()` instead of a real `ws` socket. Broadcast takes a
 * typed `WorkspaceSignal` and serialises to JSON internally so callers can't
 * accidentally broadcast a browser command.
 */

import type { WorkspaceSignal } from "@maket/shared";

/** Minimal contract a connection must satisfy to join the registry. */
export interface WsLike {
	readyState: number;
	send(data: string): void;
}

export interface WsRegistry {
	add(ws: WsLike): void;
	remove(ws: WsLike): void;
	/** True iff at least one client has readyState === 1 (OPEN). */
	hasClients(): boolean;
	/**
	 * JSON-stringifies `msg` and sends it to every OPEN client. Non-open
	 * clients are skipped, not removed.
	 */
	broadcast(msg: WorkspaceSignal): void;
}

const WS_OPEN = 1;

export function createWsRegistry(): WsRegistry {
	const clients = new Set<WsLike>();

	return {
		add(ws) {
			clients.add(ws);
		},
		remove(ws) {
			clients.delete(ws);
		},
		hasClients() {
			for (const c of clients) if (c.readyState === WS_OPEN) return true;
			return false;
		},
		broadcast(msg) {
			const payload = JSON.stringify(msg);
			for (const c of clients) if (c.readyState === WS_OPEN) c.send(payload);
		},
	};
}
