/**
 * WebSocket wire contract between the server and browser clients.
 *
 * Philosophy: strict on the envelope (discriminator + plumbing fields),
 * opaque on domain payloads. The `doc` field on `state` is whatever
 * `documents.lightView()` emits — that projection diverges between server
 * persistence and client UI, so we deliberately keep it `unknown` here.
 */

// ============================================================
// Server → Client
// ============================================================

export interface WsStateMessage {
	type: "state";
	doc: unknown;
	docList: unknown[];
	charteCss: string;
	addToWorkspace?: boolean;
	focus?: boolean;
	/** Correlation id awaited by `wsBridge.waitForResponse` after an html mutation. */
	measureId?: string;
}

export interface WsToastMessage {
	type: "toast";
	text: string;
	level: string;
	duration: number;
}

export interface WsCharteUpdatedMessage {
	type: "charte_updated";
	name: string;
	css: string;
}

export interface WsRemoveDocMessage {
	type: "remove_doc";
	name: string;
}

export interface WsAckMessagesMessage {
	type: "ack_messages";
	ids: unknown[];
}

export interface WsReloadMessage {
	type: "reload";
}

export interface WsActivityMessage {
	type: "activity";
	key: string;
	params: Record<string, string>;
	icon: string;
}

/** Signals the browser that `/api/assets` should be re-fetched. */
export interface WsAssetsChangedMessage {
	type: "assets_changed";
}

/** Server-initiated RPC awaited via `wsBridge.sendRequest`. */
export interface WsCheckLayoutRequest {
	type: "check_layout_request";
	_reqId: string;
	docName: string;
	pageIdx: number;
}

export type WsServerMessage =
	| WsStateMessage
	| WsToastMessage
	| WsCharteUpdatedMessage
	| WsRemoveDocMessage
	| WsAckMessagesMessage
	| WsReloadMessage
	| WsActivityMessage
	| WsAssetsChangedMessage
	| WsCheckLayoutRequest;

// ============================================================
// Client → Server
// ============================================================

export interface WsLoadDocumentMessage {
	type: "load_document";
	name: string;
}

export interface WsSaveDocumentMessage {
	type: "save_document";
	docName: string;
}

export interface WsDeleteDocumentMessage {
	type: "delete_document";
	name: string;
}

export interface WsRenameDocumentMessage {
	type: "rename_document";
	name: string;
	newName: string;
}

export interface WsDuplicateDocumentMessage {
	type: "duplicate_document";
	name: string;
	newName: string;
}

export interface WsLockDocumentMessage {
	type: "lock_document";
	name: string;
	locked: boolean;
}

export interface WsUpdateCanvasMessage {
	type: "update_canvas";
	docName: string;
	format?: string;
	orientation?: string;
	bg?: string;
}

export interface WsUpdateMetaMessage {
	type: "update_meta";
	docName: string;
	designNotes?: string;
	teamNotes?: string;
	rating?: number;
	charte?: string;
}

export interface WsDeleteAssetMessage {
	type: "delete_asset";
	filename: string;
}

export interface WsPageGoMessage {
	type: "page_go";
	docName: string;
	page: number;
}

export interface WsClearCanvasMessage {
	type: "clear_canvas";
	docName: string;
}

export interface WsTextEditMessage {
	type: "text_edit";
	docName: string;
	elementId: string;
	html: string;
	pageIndex?: number;
}

/**
 * A single user-authored hint attached to an element in a document — picked
 * up by Claude through the `get_messages` / `ack_messages` MCP tools. The
 * `type` field stays `string` so the UI can evolve its taxonomy (note,
 * delete, drop-image, ...) without dragging the server along.
 */
export interface PendingMessage {
	id: string;
	docName?: string;
	elementId?: string;
	pageIndex?: number;
	type?: string;
	text?: string;
	file?: string;
	position?: string;
	ts?: number;
}

/**
 * Sync the client's workspace-wide pending list to the server. The server
 * buckets entries by `p.docName` and replaces each document's `_pending`
 * with the matching subset — client is the single source of truth between
 * syncs, so the envelope itself carries no `docName`.
 */
export interface WsSyncPendingMessage {
	type: "sync_pending";
	pending: PendingMessage[];
}

export interface WsWorkspaceUpdateMessage {
	type: "workspace_update";
	displayed: string[];
}

/**
 * Browser-measured layout report. `docName` is optional because the browser
 * may measure the focused canvas without a targeted doc context; the server
 * resolves it best-effort via `wsDoc(msg)`.
 */
export interface WsLayoutReportMessage {
	type: "layout_report";
	docName?: string;
	measureId?: string;
	overflow?: boolean;
	containerHeight?: number;
	contentHeight?: number;
	overflowBy?: number;
	containerWidth?: number;
	contentWidth?: number;
	overflowByW?: number;
	overflowing?: string[];
	elements?: unknown[];
}

/** Reply to a server-initiated `check_layout_request`. */
export interface WsCheckLayoutResponse {
	type: "check_layout_response";
	_reqId: string;
	overflow?: boolean;
	containerHeight?: number;
	contentHeight?: number;
	overflowBy?: number;
	containerWidth?: number;
	contentWidth?: number;
	overflowByW?: number;
	overflowing?: string[];
	elements?: unknown[];
}

export type WsClientMessage =
	| WsLoadDocumentMessage
	| WsSaveDocumentMessage
	| WsDeleteDocumentMessage
	| WsRenameDocumentMessage
	| WsDuplicateDocumentMessage
	| WsLockDocumentMessage
	| WsUpdateCanvasMessage
	| WsUpdateMetaMessage
	| WsDeleteAssetMessage
	| WsPageGoMessage
	| WsClearCanvasMessage
	| WsTextEditMessage
	| WsSyncPendingMessage
	| WsWorkspaceUpdateMessage
	| WsLayoutReportMessage
	| WsCheckLayoutResponse;
