/**
 * WebSocket wire contract between the server and browser clients.
 *
 * Philosophy: strict on the envelope (discriminator + plumbing fields),
 * opaque on domain payloads. The `doc` field on `state` is whatever
 * `documents.lightView()` emits — that projection diverges between server
 * persistence and client UI, so we deliberately keep it `unknown` here.
 *
 * `WorkspaceCommand` is what the browser asks Maket to do. `WorkspaceSignal`
 * is what Maket announces back to the browser. Keep those directional types
 * on public send/broadcast APIs; `WorkspaceMessage` exists only for parsing
 * or dispatch code that intentionally handles the complete wire vocabulary.
 *
 * Partial-update messages (`update_meta`, `update_charte_meta`,
 * `update_asset_meta`) carry only fields to merge; omitted fields are
 * preserved server-side. Full-record writes use a different verb
 * (`charte_save`).
 */

// ============================================================
// Protocol notifications and requests
// ============================================================

export interface WorkspaceStateSignal {
	type: "state";
	doc: unknown;
	docList: unknown[];
	collections?: unknown[];
	charteCss: string;
	addToWorkspace?: boolean;
	focus?: boolean;
	/** Correlation id awaited by `wsBridge.waitForResponse` after an html mutation. */
	measureId?: string;
}

export interface ToastSignal {
	type: "toast";
	text: string;
	level: string;
	duration: number;
}

export interface CharteUpdatedSignal {
	type: "charte_updated";
	name: string;
	css: string;
}

/** Distinct from `charte_updated`: announces deletion. Replaces the legacy
 * overload where `charte_updated` with `css: ""` signalled removal. */
export interface CharteRemovedSignal {
	type: "charte_removed";
	name: string;
}

export interface DocumentRemovedSignal {
	type: "doc_removed";
	name: string;
}

export interface PendingAcknowledgedSignal {
	type: "ack_messages";
	ids: unknown[];
}

export interface WorkspaceReloadSignal {
	type: "reload";
}

export interface ActivitySignal {
	type: "activity";
	key: string;
	params: Record<string, string>;
	icon: string;
}

/** Signals the browser that `/api/assets` should be re-fetched. */
export interface AssetsChangedSignal {
	type: "assets_changed";
}

export interface CollectionsChangedSignal {
	type: "collections_changed";
	collections: unknown[];
}

/** Asks the client to fit the whole workspace to view (like the Maximize button). */
export interface FitViewSignal {
	type: "fit_view";
}

/** Server-initiated RPC awaited via `wsBridge.sendRequest`. */
export interface LayoutCheckRequest {
	type: "check_layout_request";
	_reqId: string;
	docName: string;
	pageIdx: number;
}

// ============================================================
// Protocol commands and responses
// ============================================================

export interface LoadDocumentCommand {
	type: "load_document";
	name: string;
}

export interface SaveDocumentCommand {
	type: "save_document";
	docName: string;
}

export interface DeleteDocumentCommand {
	type: "delete_document";
	name: string;
}

export interface RenameDocumentCommand {
	type: "rename_document";
	name: string;
	newName: string;
}

export interface DuplicateDocumentCommand {
	type: "duplicate_document";
	name: string;
	newName: string;
}

export interface LockDocumentCommand {
	type: "lock_document";
	name: string;
	locked: boolean;
}

export interface OpenOnboardingCommand {
	type: "open_onboarding";
	lang?: "en" | "fr";
}

export interface UpdateCanvasCommand {
	type: "update_canvas";
	docName: string;
	format?: string;
	orientation?: string;
	bg?: string;
}

export interface UpdateDocumentMetadataCommand {
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

export interface DeleteAssetCommand {
	type: "delete_asset";
	filename: string;
}

/**
 * Partial update of an asset's metadata row. Mirrors `update_meta` for docs
 * and `update_charte_meta` for chartes — same clear-vs-preserve rule across
 * the three: only `undefined` preserves; `""` clears a string field, `[]`
 * clears tags. Identity is `filename` (renames are out of envelope).
 */
export interface UpdateAssetMetadataCommand {
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
export interface SaveCharteCommand {
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
export interface UpdateCharteMetadataCommand {
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

export interface SaveCollectionCommand {
	type: "collection_save";
	collection: unknown;
}

export interface DeleteCollectionCommand {
	type: "collection_delete";
	name: string;
}

export interface BindPageCollectionCommand {
	type: "collection_bind_page";
	docName: string;
	pageIndex: number;
	collectionName: string;
}

export interface ClearPageCollectionCommand {
	type: "collection_clear_page";
	docName: string;
	pageIndex: number;
}

export interface ShowPageCommand {
	type: "page_go";
	docName: string;
	page: number;
}

export interface ClearCanvasCommand {
	type: "clear_canvas";
	docName: string;
}

export interface EditTextCommand {
	type: "text_edit";
	docName: string;
	elementId: string;
	html: string;
	pageIndex?: number;
}

/**
 * A single user-authored hint attached to an element in a document — picked
 * up by Claude through the `list_messages` / `ack_messages` MCP tools. The
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
export interface SyncPendingMessagesCommand {
	type: "sync_pending";
	pending: PendingMessage[];
}

export interface UpdateWorkspaceCommand {
	type: "workspace_update";
	displayed: string[];
}

/**
 * Browser-measured layout report. `docName` is optional because the browser
 * may measure the focused canvas without a targeted doc context; the server
 * resolves it best-effort via `wsDoc(msg)`.
 */
export interface LayoutReportCommand {
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
export interface LayoutCheckResult {
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

export type WorkspaceSignal =
	| WorkspaceStateSignal
	| ToastSignal
	| CharteUpdatedSignal
	| CharteRemovedSignal
	| DocumentRemovedSignal
	| PendingAcknowledgedSignal
	| WorkspaceReloadSignal
	| ActivitySignal
	| AssetsChangedSignal
	| CollectionsChangedSignal
	| FitViewSignal
	| LayoutCheckRequest;

export type WorkspaceCommand =
	| LoadDocumentCommand
	| SaveDocumentCommand
	| DeleteDocumentCommand
	| RenameDocumentCommand
	| DuplicateDocumentCommand
	| LockDocumentCommand
	| OpenOnboardingCommand
	| UpdateCanvasCommand
	| UpdateDocumentMetadataCommand
	| DeleteAssetCommand
	| UpdateAssetMetadataCommand
	| SaveCharteCommand
	| UpdateCharteMetadataCommand
	| SaveCollectionCommand
	| DeleteCollectionCommand
	| BindPageCollectionCommand
	| ClearPageCollectionCommand
	| ShowPageCommand
	| ClearCanvasCommand
	| EditTextCommand
	| SyncPendingMessagesCommand
	| UpdateWorkspaceCommand
	| LayoutReportCommand
	| LayoutCheckResult;

export type WorkspaceMessage = WorkspaceSignal | WorkspaceCommand;

export type LayoutCheckRequestDraft = Omit<LayoutCheckRequest, "_reqId">;
