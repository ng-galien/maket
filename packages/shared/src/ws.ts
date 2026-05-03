/**
 * WebSocket wire contract between the server and browser clients.
 *
 * Philosophy: strict on the envelope (discriminator + plumbing fields),
 * opaque on domain payloads. The `doc` field on `state` is whatever
 * `documents.lightView()` emits — that projection diverges between server
 * persistence and client UI, so we deliberately keep it `unknown` here.
 *
 * Naming convention:
 *   - client → server: `verb_resource` — the client asks the server to
 *     perform an action (`load_document`, `update_meta`, `delete_asset`).
 *     Partial-update messages (`update_meta`, `update_charte_meta`,
 *     `update_asset_meta`) carry only fields to merge; omitted fields are
 *     preserved server-side. Full-record writes use a different verb
 *     (`charte_save`).
 *   - server → client: notification names — the server announces a fact.
 *     Either a noun (`state`, `toast`, `activity`) or `noun_pastVerb`
 *     (`charte_updated`, `charte_removed`, `assets_changed`, `doc_removed`).
 *   - RPC pairs use `<name>_request` / `<name>_response` (see
 *     `check_layout_*`).
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

/** Distinct from `charte_updated`: announces deletion. Replaces the legacy
 * overload where `charte_updated` with `css: ""` signalled removal. */
export interface WsCharteRemovedMessage {
	type: "charte_removed";
	name: string;
}

export interface WsDocRemovedMessage {
	type: "doc_removed";
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

/** Asks the client to fit the whole workspace to view (like the Maximize button). */
export interface WsFitViewMessage {
	type: "fit_view";
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
	| WsCharteRemovedMessage
	| WsDocRemovedMessage
	| WsAckMessagesMessage
	| WsReloadMessage
	| WsActivityMessage
	| WsAssetsChangedMessage
	| WsFitViewMessage
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
	/** Re-classify the document into a different category. The server
	 * writes to `doc.category` (top-level), not `doc.meta`. */
	category?: string;
}

export interface WsDeleteAssetMessage {
	type: "delete_asset";
	filename: string;
}

/**
 * Partial update of an asset's metadata row. Mirrors `update_meta` for docs:
 * only fields explicitly set are written; omitted fields are preserved.
 * Identity is `filename` — renaming an asset is not part of this envelope.
 *
 * Clear-vs-preserve semantics: only `undefined` preserves. Pass `""` to clear
 * a string field, `[]` to clear tags. The server-side `saveAsset` honours
 * this via `?? null` for prose fields plus a `$tags_set` flag for tags;
 * symmetric with `update_charte_meta` (which merges in JS) and
 * `update_meta` (`!= null` checks let `""` through for prose fields).
 */
export interface WsUpdateAssetMetaMessage {
	type: "update_asset_meta";
	filename: string;
	title?: string;
	description?: string;
	category?: string;
	tags?: string[];
	credit?: string;
	orientation?: string;
}

/**
 * Write a full charte record. Name is the identity — renaming is not part of
 * this envelope; clients wanting to rename should `charte_save` under the new
 * name and then call `maket_charte delete` on the old one. Tokens/voice/rules
 * fully replace the stored values (no partial merge — use
 * `update_charte_meta` for partial edits).
 */
export interface WsCharteSaveMessage {
	type: "charte_save";
	name: string;
	description?: string;
	tokens?: Record<string, Record<string, string>>;
	voice?: {
		personality?: string[];
		formality?: string;
		do?: string[];
		dont?: string[];
		vocabulary?: string[];
	};
	rules?: Record<string, string>;
}

/**
 * Partial update of a charte. Mirrors `update_meta` for docs and
 * `update_asset_meta` for assets: only fields explicitly set are merged;
 * omitted fields are preserved server-side. Use this for editing
 * description/voice/rules without rebuilding tokens, or vice versa.
 */
export interface WsUpdateCharteMetaMessage {
	type: "update_charte_meta";
	name: string;
	description?: string;
	tokens?: Record<string, Record<string, string>>;
	voice?: {
		personality?: string[];
		formality?: string;
		do?: string[];
		dont?: string[];
		vocabulary?: string[];
	};
	rules?: Record<string, string>;
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
	| WsUpdateAssetMetaMessage
	| WsCharteSaveMessage
	| WsUpdateCharteMetaMessage
	| WsPageGoMessage
	| WsClearCanvasMessage
	| WsTextEditMessage
	| WsSyncPendingMessage
	| WsWorkspaceUpdateMessage
	| WsLayoutReportMessage
	| WsCheckLayoutResponse;
