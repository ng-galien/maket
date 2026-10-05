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
	add(ws: WsLike, options?: { viewer?: boolean }): void;
	watch(ws: WsLike, docName: string): void;
	isViewer(ws: WsLike): boolean;
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
	const clients = new Map<
		WsLike,
		{ viewer: boolean; docName: string | null }
	>();

	return {
		add(ws, options) {
			clients.set(ws, { viewer: options?.viewer ?? false, docName: null });
		},
		isViewer(ws) {
			return clients.get(ws)?.viewer ?? false;
		},
		watch(ws, docName) {
			const client = clients.get(ws);
			if (client?.viewer) client.docName = docName;
		},
		remove(ws) {
			clients.delete(ws);
		},
		hasClients() {
			for (const c of clients.keys()) if (c.readyState === WS_OPEN) return true;
			return false;
		},
		broadcast(msg) {
			const payload = JSON.stringify(msg);
			for (const [client, options] of clients) {
				if (client.readyState !== WS_OPEN) continue;
				if (!options.viewer) {
					client.send(payload);
					continue;
				}
				if (
					msg.type === "state" &&
					(msg.doc as { name?: string } | null)?.name === options.docName
				) {
					client.send(
						JSON.stringify({
							...msg,
							structuredWorkspaces: undefined,
							focus: false,
							addToWorkspace: false,
						}),
					);
				} else if (
					msg.type === "state_pages" &&
					msg.docName === options.docName
				) {
					client.send(payload);
				} else if (
					msg.type === "doc_renamed" &&
					msg.oldName === options.docName
				) {
					options.docName = (msg.doc as { name: string }).name;
					client.send(
						JSON.stringify({ ...msg, structuredWorkspaces: undefined }),
					);
				} else if (msg.type === "doc_removed" && msg.name === options.docName) {
					client.send(payload);
				} else if (msg.type === "reload" || msg.type === "settings") {
					client.send(payload);
				}
			}
		},
	};
}
