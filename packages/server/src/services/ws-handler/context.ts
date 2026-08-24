/**
 * Shared context for workspace command handlers.
 */

import type { WorkspaceCommand } from "@maket/shared";
import type WebSocket from "ws";
import type { Document } from "../../types.js";
import type { Annotations } from "../annotations.js";
import type { AssetsService } from "../assets.js";
import type { Bus } from "../bus.js";
import type { CollectionCursors } from "../collection-cursor.js";
import type { Collections } from "../collections.js";
import type { DocumentRenderer } from "../document-renderer.js";
import type { DocumentStates } from "../document-states.js";
import type { Documents } from "../documents.js";
import type { SettingsService } from "../settings.js";
import type { Store } from "../store.js";
import type { WsRegistry } from "../ws-registry.js";

export type WorkspaceCommandHandler = (
	msg: WorkspaceCommand,
	ws: WebSocket,
) => void;

export interface WsHandlerDeps {
	assets: AssetsService;
	bus: Bus;
	collections?: Collections;
	collectionCursors?: CollectionCursors;
	documentRenderer: DocumentRenderer;
	documentStates: DocumentStates;
	documents: Documents;
	pending: Annotations;
	settings: SettingsService;
	store: Store;
	wsRegistry: WsRegistry;
}

export interface WsHandlerContext
	extends Omit<WsHandlerDeps, "collections" | "collectionCursors"> {
	collections: Collections;
	collectionCursors: CollectionCursors;
	broadcastState(d: Document | null): void;
	wsDoc(msg: { docName?: string }): Document | null;
}

export const log = (...a: unknown[]) =>
	process.stderr.write(`${a.map(String).join(" ")}\n`);

export function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((s) => typeof s === "string");
}
