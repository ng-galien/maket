/**
 * pending — single source of truth for user-originated pending messages.
 *
 * A pending message is a user note or flag captured in the browser (delete
 * marker, image drop, review comment, library-wide alert). The client holds
 * the full workspace queue and pushes it to the server via a
 * `sync_pending` WS message; the server buckets entries here and the MCP
 * `maket_workspace` tool (list_messages/ack_messages) reads them so the agent can act and ack.
 *
 * Two buckets:
 *  - per-doc (`byDoc: Map<docName, PendingMessage[]>`) — messages tied to a
 *    specific document (element-level flags, drops).
 *  - workspace (`workspace: PendingMessage[]`) — messages with no `docName`,
 *    such as library-wide nudges like "classify new images".
 *
 * The service is stateless across process restarts — the client re-syncs
 * on WebSocket reconnect (see CLAUDE.md "Pending messages resync gap").
 */

import type { PendingMessage } from "../types.js";
import type { Bus } from "./bus.js";

export interface Pending {
	/**
	 * Replace the entire queue with the client's authoritative snapshot.
	 * Messages without `docName` land in the workspace bucket; the rest get
	 * bucketed by their `docName`. Any doc absent from the snapshot gets its
	 * bucket cleared, matching the single-source-of-truth invariant.
	 */
	syncFromClient(messages: PendingMessage[]): void;
	/** Pending messages attached to a specific document. */
	forDoc(docName: string): PendingMessage[];
	/** Pending messages not attached to any document (library-wide). */
	forWorkspace(): PendingMessage[];
	/**
	 * Every pending message across both buckets, in a single flat list.
	 * Each message carries its own `docName` (or none for workspace scope),
	 * so the agent can filter client-side without round-trips.
	 */
	all(): PendingMessage[];
	/**
	 * Remove messages from either bucket by id. Returns which ids matched and
	 * which were unknown. Emits `messages:acked` with the matched ids when
	 * anything was removed, so other WS clients can drop them locally.
	 */
	ack(ids: string[]): { matched: string[]; unknown: string[] };
	/** Drop every pending entry attached to `docName`. Called when a doc is deleted. */
	dropDoc(docName: string): void;
}

export interface PendingDeps {
	bus: Bus;
}

export function createPending({ bus }: PendingDeps): Pending {
	const byDoc = new Map<string, PendingMessage[]>();
	let workspace: PendingMessage[] = [];

	function partitionAck(
		list: PendingMessage[],
		wanted: Set<string>,
		matched: string[],
	): PendingMessage[] {
		const kept: PendingMessage[] = [];
		for (const message of list) {
			if (wanted.has(message.id)) matched.push(message.id);
			else kept.push(message);
		}
		return kept;
	}

	return {
		syncFromClient(messages) {
			const nextByDoc = new Map<string, PendingMessage[]>();
			const nextWorkspace: PendingMessage[] = [];
			for (const m of messages) {
				if (m.docName) {
					const arr = nextByDoc.get(m.docName) ?? [];
					arr.push(m);
					nextByDoc.set(m.docName, arr);
				} else {
					nextWorkspace.push(m);
				}
			}
			byDoc.clear();
			for (const [k, v] of nextByDoc) byDoc.set(k, v);
			workspace = nextWorkspace;
		},
		forDoc(docName) {
			return byDoc.get(docName) ?? [];
		},
		forWorkspace() {
			return workspace;
		},
		all() {
			const out: PendingMessage[] = [...workspace];
			for (const list of byDoc.values()) out.push(...list);
			return out;
		},
		ack(ids) {
			if (ids.length === 0) return { matched: [], unknown: [] };
			const wanted = new Set(ids);
			const matched: string[] = [];
			for (const [name, list] of byDoc) {
				const kept = partitionAck(list, wanted, matched);
				if (kept.length === 0) byDoc.delete(name);
				else byDoc.set(name, kept);
			}
			workspace = partitionAck(workspace, wanted, matched);
			const unknown = ids.filter((id) => !matched.includes(id));
			if (matched.length > 0) bus.emit("messages:acked", { ids: matched });
			return { matched, unknown };
		},
		dropDoc(docName) {
			byDoc.delete(docName);
		},
	};
}
