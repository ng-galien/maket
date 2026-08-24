import type { ActivityKey } from "./activity.js";
import type { DocumentStateClientView } from "./document-state.js";
import type { Settings } from "./settings.js";
import type { ToastKey, ToastLevel } from "./toast.js";

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
 * Partial document metadata updates carry only fields to merge; omitted
 * fields are preserved server-side. Full-record writes use distinct verbs
 * such as `charte_save`.
 */

import type {
	CollectionCursorMode,
	PageCollectionCursor,
} from "./collection-cursor.js";

// ============================================================
// Protocol notifications and requests
// ============================================================

export interface WorkspaceStateSignal {
	type: "state";
	doc: unknown;
	docList: unknown[];
	collections?: unknown[];
	/** Server-owned page↔collection preview cursors (full snapshot). */
	collectionCursors?: PageCollectionCursor[];
	charteCss: string;
	addToWorkspace?: boolean;
	focus?: boolean;
	/** Present for state-backed documents: raw data, schema, revision, templates. */
	documentState?: DocumentStateClientView | null;
	/** Persistent server-owned annotations mirrored by every browser client. */
	annotations?: PendingMessage[];
}

export interface StatePageProjectionSignal {
	type: "state_pages";
	docName: string;
	documentState: DocumentStateClientView;
	pages: Array<{ index: number; html?: string }>;
	docList: unknown[];
}

export interface StatePatchResultSignal {
	type: "state_patch_result";
	requestId: string;
	ok: boolean;
	revision?: number;
	error?: string;
}

export interface ToastSignal {
	type: "toast";
	key: ToastKey;
	params?: Record<string, string>;
	level: ToastLevel;
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

/** Atomically replaces a persistent document identity in each browser.
 * Clients that display or focus `oldName` must preserve that local position
 * under the renamed document instead of treating the rename as delete + open. */
export interface DocumentRenamedSignal {
	type: "doc_renamed";
	oldName: string;
	doc: unknown;
	docList: unknown[];
	collections?: unknown[];
	collectionCursors?: PageCollectionCursor[];
	charteCss: string;
	documentState?: DocumentStateClientView | null;
	annotations?: PendingMessage[];
}

export interface PendingAcknowledgedSignal {
	type: "ack_messages";
	ids: unknown[];
}

export interface AnnotationsChangedSignal {
	type: "annotations_changed";
	annotations: PendingMessage[];
}

export interface AnnotationCreateResultSignal {
	type: "annotation_create_result";
	requestId: string;
	ok: boolean;
	error?: string;
}

export interface WorkspaceReloadSignal {
	type: "reload";
}

export interface ActivitySignal {
	type: "activity";
	key: ActivityKey;
	params: Record<string, string>;
	icon: string;
}

export interface AssetCategoryUpdate {
	filename: string;
	category: string;
}

/** Signals the browser that assets changed. Category-only mutations carry a
 * delta so the photo library can update without re-fetching every asset. */
export interface AssetsChangedSignal {
	type: "assets_changed";
	categoryUpdates?: AssetCategoryUpdate[];
}

export interface CollectionsChangedSignal {
	type: "collections_changed";
	collections: unknown[];
}

/** Full snapshot of every page↔collection cursor. Broadcast whenever any
 * cursor moves — server-authoritative, clients replace their mirror wholesale. */
export interface CollectionCursorsSignal {
	type: "collection_cursors";
	cursors: PageCollectionCursor[];
}

/** Asks the client to fit the whole workspace to view (like the Maximize button). */
export interface FitViewSignal {
	type: "fit_view";
}

// ============================================================
// Protocol commands and responses
// ============================================================

export interface LoadDocumentCommand {
	type: "load_document";
	name: string;
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

export interface MoveCategoryCommand {
	type: "move_category";
	/** Existing category path whose documents and descendants move together. */
	source: string;
	/** Complete destination path, including the category's final leaf name. */
	destination: string;
}

export interface DeleteAssetCommand {
	type: "delete_asset";
	filename: string;
}

export interface UpdateAssetCategoryCommand {
	type: "update_asset_category";
	filename: string;
	category: string;
}

export interface MoveAssetCategoryCommand {
	type: "move_asset_category";
	/** Existing image category path whose assets and descendants move together. */
	source: string;
	/** Complete destination path, including the category's final leaf name. */
	destination: string;
}

/**
 * Write a full charte record. Name is the identity — renaming is not part of
 * this envelope; clients wanting to rename should `charte_save` under the new
 * name and then call `maket_charte delete` on the old one. Tokens/voice/rules
 * fully replace the stored values.
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

/**
 * Move the preview cursor of one page↔collection binding. Partial: omitted
 * fields keep their current value. `memberId: null` explicitly clears the
 * row selection (empty collection); `undefined` preserves it.
 */
export interface SetCollectionCursorCommand {
	type: "collection_cursor_set";
	docName: string;
	pageIndex: number;
	mode?: CollectionCursorMode;
	memberId?: string | null;
}

export interface EditTextCommand {
	type: "text_edit";
	docName: string;
	elementId: string;
	html: string;
	pageIndex?: number;
}

export interface PatchDocumentStateCommand {
	type: "state_patch";
	requestId: string;
	docName: string;
	expectedRevision: number;
	operation: {
		op: "replace";
		path: string;
		value: null | string | number | boolean;
	};
}

/**
 * A single user-authored hint attached to an element in a document — picked
 * up by an agent through the `list_messages` / `ack_messages` MCP tools. The
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

export interface CreateAnnotationCommand {
	type: "annotation_create";
	requestId: string;
	annotation: PendingMessage;
}

export interface RemoveAnnotationCommand {
	type: "annotation_remove";
	id: string;
}

export interface UpdateWorkspaceCommand {
	type: "workspace_update";
	displayed: string[];
}

/** Server-authored settings snapshot. Sent on connect and after every change. */
export interface SettingsSignal {
	type: "settings";
	settings: Settings;
}

/** Partial update; omitted fields keep their persisted value. */
export interface SetSettingsCommand {
	type: "settings_set";
	settings: Partial<Settings>;
}

export type WorkspaceSignal =
	| WorkspaceStateSignal
	| StatePageProjectionSignal
	| StatePatchResultSignal
	| ToastSignal
	| CharteUpdatedSignal
	| CharteRemovedSignal
	| DocumentRemovedSignal
	| DocumentRenamedSignal
	| PendingAcknowledgedSignal
	| AnnotationsChangedSignal
	| AnnotationCreateResultSignal
	| WorkspaceReloadSignal
	| ActivitySignal
	| AssetsChangedSignal
	| CollectionsChangedSignal
	| CollectionCursorsSignal
	| FitViewSignal
	| SettingsSignal;

export type WorkspaceCommand =
	| LoadDocumentCommand
	| DeleteDocumentCommand
	| RenameDocumentCommand
	| DuplicateDocumentCommand
	| LockDocumentCommand
	| OpenOnboardingCommand
	| UpdateDocumentMetadataCommand
	| MoveCategoryCommand
	| DeleteAssetCommand
	| UpdateAssetCategoryCommand
	| MoveAssetCategoryCommand
	| SaveCharteCommand
	| SaveCollectionCommand
	| DeleteCollectionCommand
	| BindPageCollectionCommand
	| ClearPageCollectionCommand
	| SetCollectionCursorCommand
	| EditTextCommand
	| PatchDocumentStateCommand
	| CreateAnnotationCommand
	| RemoveAnnotationCommand
	| UpdateWorkspaceCommand
	| SetSettingsCommand;

export type WorkspaceMessage = WorkspaceSignal | WorkspaceCommand;
