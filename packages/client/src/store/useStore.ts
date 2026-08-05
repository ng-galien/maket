import {
	type Collection,
	type CollectionCursorMode,
	collectionCursorKey,
	type DocumentStateClientView,
	type PageCollectionCursor,
} from "@maket/shared";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import type { DocSummary, Document } from "./types";
import { wsSend } from "./ws";

export type CollectionPreviewMode = CollectionCursorMode;
export type StateCanvasMode = "live" | "design";

export function statePatchKey(docName: string, pointer: string): string {
	return `${docName}\u0000${pointer}`;
}

export function hasPendingStatePatchForDocument(
	statePatchPending: Record<string, string>,
	docName: string,
): boolean {
	const prefix = `${docName}\u0000`;
	return Object.keys(statePatchPending).some((key) => key.startsWith(prefix));
}

export interface DraftCursorOverride {
	docName: string;
	pageIndex: number;
	memberId: string;
}

export interface PendingMessage {
	id: string;
	type: "note" | "delete" | "drop-image" | "drop-text" | "classify-images";
	elementId?: string;
	docName?: string;
	pageIndex?: number;
	text?: string;
	file?: string;
	position?: string;
	ts: number;
}

interface CollectionSlice {
	focusedCollectionName: string | null;
	/** Pinned data view: survives reloads (name + flag in localStorage) and
	 * is surfaced in the toolbar. */
	dataViewPinned: boolean;
	toggleDataViewPinned: () => void;
	/** Server-owned page↔collection cursors, mirrored wholesale from `state`
	 * pushes and `collection_cursors` signals. Keyed by collectionCursorKey. */
	collectionCursors: Record<string, PageCollectionCursor>;
	/**
	 * Local preview cursor for rows that only exist in a draft — the server
	 * cannot point at them yet. The canvas renders them client-side (same
	 * accepted divergence as edited draft values); on save the override is
	 * promoted to the shared server cursor. Keyed by collectionCursorKey.
	 */
	draftCursorOverrides: Record<string, DraftCursorOverride>;
	setDraftCursorOverride: (
		docName: string,
		pageIndex: number,
		memberId: string | null,
	) => void;
	collections: Collection[];
	collectionDrafts: Record<string, Collection>;
	setCollections: (collections: Collection[]) => void;
	setCollectionCursors: (cursors: PageCollectionCursor[]) => void;
	setFocusedCollection: (name: string | null) => void;
	setCollectionDraft: (collection: Collection) => void;
	clearCollectionDraft: (name: string) => void;
	setCursorMode: (
		docName: string,
		pageIndex: number,
		mode: CollectionCursorMode,
	) => void;
	setCursorMember: (
		docName: string,
		pageIndex: number,
		memberId: string | null,
	) => void;
	moveCursorMember: (docName: string, pageIndex: number, delta: number) => void;
}

interface DocumentStateSlice {
	documentStates: Record<string, DocumentStateClientView>;
	stateCanvasModes: Record<string, StateCanvasMode>;
	statePatchPending: Record<string, string>;
	statePatchRequests: Record<string, string>;
	statePatchErrors: Record<string, string>;
	setDocumentState: (
		docName: string,
		view: DocumentStateClientView | null,
	) => void;
	applyStatePages: (
		docName: string,
		pages: Array<{ index: number; html?: string }>,
		view: DocumentStateClientView,
		docList: DocSummary[],
	) => void;
	setStateCanvasMode: (docName: string, mode: StateCanvasMode) => void;
	beginStatePatch: (
		docName: string,
		pointer: string,
		requestId: string,
	) => void;
	timeoutStatePatch: (requestId: string, error: string) => void;
	settleStatePatch: (requestId: string, error?: string) => void;
	clearStatePatches: () => void;
}

interface AppState extends CollectionSlice, DocumentStateSlice {
	// Connection
	connected: boolean;

	// Multi-doc workspace
	docs: Map<string, Document>;
	workspaceDocNames: string[];
	focusedDocName: string | null;
	focusedPageIndex: number;

	// Global
	docList: DocSummary[];
	chartesCss: Map<string, string>;
	chartesVersion: number;

	// UI
	/** Viewer mode: hides edit affordances and disables workspace persistence */
	readOnly: boolean;
	selectedIds: string[];
	editingElementId: string | null;
	showPopover: boolean;
	activePanel:
		| "chartes"
		| "photos"
		| "docs"
		| "collections"
		| "exchange"
		| null;
	barPosition: "top" | "bottom";
	darkMode: boolean;
	locked: boolean;
	zoom: number;
	autoFocusFit: boolean;

	// Pending messages (user → Claude)
	pending: PendingMessage[];

	// Actions
	setConnected: (v: boolean) => void;
	upsertDoc: (
		doc: Document,
		docList: DocSummary[],
		charteCss?: string,
		addToWorkspace?: boolean,
		focus?: boolean,
	) => void;
	addDocToWorkspace: (docName: string) => void;
	removeDocFromWorkspace: (docName: string) => void;
	setFocusedDoc: (docName: string | null) => void;
	setFocusedPage: (docName: string, pageIndex: number) => void;
	selectElement: (id: string | null, toggle?: boolean) => void;
	setEditingElement: (id: string | null) => void;
	setActivePanel: (
		v: "chartes" | "photos" | "docs" | "collections" | "exchange" | null,
	) => void;
	togglePanel: (
		panel: "chartes" | "photos" | "docs" | "collections" | "exchange",
	) => void;
	setBarPosition: (v: "top" | "bottom") => void;
	setDarkMode: (v: boolean) => void;
	toggleDarkMode: () => void;
	setLocked: (v: boolean) => void;
	setZoom: (v: number) => void;
	toggleAutoFocusFit: () => void;
	addPending: (msg: PendingMessage) => void;
	removePending: (id: string) => void;

	// Deprecated — backward compat
	setServerState: (
		doc: Document | null,
		docList: DocSummary[],
		charteCss?: string,
	) => void;
}

function syncPending() {
	setTimeout(() => {
		wsSend({ type: "sync_pending", pending: useStore.getState().pending });
	}, 0);
}

function syncWorkspace() {
	setTimeout(() => {
		wsSend({
			type: "workspace_update",
			displayed: useStore.getState().workspaceDocNames,
		});
	}, 0);
}

function loadWorkspace(): string[] {
	try {
		return JSON.parse(localStorage.getItem("maket-workspace") || "null") ?? [];
	} catch {
		return [];
	}
}

// Invariant: workspace STATE (doc list, focused doc) is never persisted in
// readOnly/viewer mode — gate every such helper below. UI PREFS (dark mode,
// bar position, auto-focus-fit) deliberately persist everywhere.
function saveWorkspace(names: string[]) {
	if (useStore.getState().readOnly) return;
	localStorage.setItem("maket-workspace", JSON.stringify(names));
}

function saveFocusedDoc(name: string) {
	if (useStore.getState().readOnly) return;
	localStorage.setItem("maket-focused-doc", name);
}

function persistDataViewPin(pinned: boolean, collectionName: string | null) {
	if (useStore.getState().readOnly) return;
	localStorage.setItem("maket-data-view-pinned", String(pinned));
	if (pinned && collectionName) {
		localStorage.setItem("maket-data-view-collection", collectionName);
	} else {
		localStorage.removeItem("maket-data-view-collection");
	}
}

function reconcileCollectionDrafts(
	current: Record<string, Collection>,
	collections: readonly Collection[],
): Record<string, Collection> {
	const savedNames = new Set(collections.map((collection) => collection.name));
	return Object.fromEntries(
		Object.entries(current).filter(([name, draft]) => {
			const saved = collections.find((collection) => collection.name === name);
			return savedNames.has(name) && hasChangedCollection(saved, draft);
		}),
	);
}

function hasChangedCollection(
	source: Collection | undefined,
	draft: Collection,
): boolean {
	return source ? JSON.stringify(source) !== JSON.stringify(draft) : true;
}

/**
 * Re-align draft cursor overrides with a fresh server collection push:
 * a row that is now saved graduates to the shared cursor (`promoted`), a
 * row still draft-only stays local, anything else (discarded draft,
 * deleted row) is dropped.
 */
function reconcileDraftCursorOverrides(
	overrides: Record<string, DraftCursorOverride>,
	collections: readonly Collection[],
	drafts: Record<string, Collection>,
): {
	kept: Record<string, DraftCursorOverride>;
	promoted: DraftCursorOverride[];
} {
	const kept: Record<string, DraftCursorOverride> = {};
	const promoted: DraftCursorOverride[] = [];
	const state = useStore.getState();
	for (const [key, override] of Object.entries(overrides)) {
		const collectionName = state.docs.get(override.docName)?.pages[
			override.pageIndex
		]?.collection?.name;
		if (!collectionName) continue;
		const saved = collections.find((item) => item.name === collectionName);
		if (saved?.members.some((member) => member.id === override.memberId)) {
			promoted.push(override);
			continue;
		}
		const draft = drafts[collectionName];
		if (draft?.members.some((member) => member.id === override.memberId)) {
			kept[key] = override;
		}
	}
	return { kept, promoted };
}

export function sortedCollectionMembers(
	collection: Collection | undefined | null,
) {
	return collection
		? [...collection.members].sort((a, b) => a.position - b.position)
		: [];
}

/**
 * Effective cursor of a bound page: the server mirror when present, else the
 * same default the server would lazily create (template mode, first row).
 * Returns null when the page has no collection binding.
 */
export function cursorForPage(
	state: Pick<
		AppState,
		"docs" | "collections" | "collectionDrafts" | "collectionCursors"
	>,
	docName: string,
	pageIndex: number,
): PageCollectionCursor | null {
	const collectionName =
		state.docs.get(docName)?.pages[pageIndex]?.collection?.name;
	if (!collectionName) return null;
	const mirrored =
		state.collectionCursors[collectionCursorKey(docName, pageIndex)];
	if (mirrored && mirrored.collection === collectionName) return mirrored;
	const collection =
		state.collectionDrafts[collectionName] ??
		state.collections.find((item) => item.name === collectionName);
	return {
		docName,
		pageIndex,
		collection: collectionName,
		mode: "template",
		memberId: sortedCollectionMembers(collection)[0]?.id ?? null,
	};
}

/**
 * What the canvas should display for a page: the shared server cursor,
 * except when a draft-only row is being previewed locally — then the
 * override's member (rendered client-side from the draft) takes over.
 */
export function previewCursorForPage(
	state: Pick<
		AppState,
		| "docs"
		| "collections"
		| "collectionDrafts"
		| "collectionCursors"
		| "draftCursorOverrides"
	>,
	docName: string,
	pageIndex: number,
): PageCollectionCursor | null {
	const cursor = cursorForPage(state, docName, pageIndex);
	if (!cursor) return null;
	const override =
		state.draftCursorOverrides[collectionCursorKey(docName, pageIndex)];
	if (!override) return cursor;
	const draft = state.collectionDrafts[cursor.collection];
	const exists = draft?.members.some(
		(member) => member.id === override.memberId,
	);
	return exists ? { ...cursor, memberId: override.memberId } : cursor;
}

function clampPageIndex(doc: Document | undefined, pageIndex: number): number {
	if (!doc || doc.pages.length === 0) return 0;
	return Math.min(doc.pages.length - 1, Math.max(0, Math.trunc(pageIndex)));
}

function preservePageIndex(
	previousDoc: Document | undefined,
	nextDoc: Document | undefined,
	previousIndex: number,
): number {
	const previousPageId =
		previousDoc?.pages[clampPageIndex(previousDoc, previousIndex)]?.id;
	const nextIndex = previousPageId
		? nextDoc?.pages.findIndex((page) => page.id === previousPageId)
		: -1;
	return nextIndex !== undefined && nextIndex >= 0
		? nextIndex
		: clampPageIndex(nextDoc, nextDoc?.activePage ?? 0);
}

const _savedWorkspace = loadWorkspace();
const _savedFocused = localStorage.getItem("maket-focused-doc") || null;
const _savedDataViewPinned =
	localStorage.getItem("maket-data-view-pinned") === "true";
const _savedDataViewCollection = _savedDataViewPinned
	? localStorage.getItem("maket-data-view-collection")
	: null;

export const useStore = create<AppState>((set, get) => ({
	connected: false,
	docs: new Map(),
	workspaceDocNames: _savedWorkspace,
	focusedDocName:
		_savedFocused && _savedWorkspace.includes(_savedFocused)
			? _savedFocused
			: null,
	focusedPageIndex: 0,
	focusedCollectionName: _savedDataViewCollection,
	dataViewPinned: _savedDataViewPinned,
	collectionCursors: {},
	draftCursorOverrides: {},
	collectionDrafts: {},
	docList: [],
	documentStates: {},
	stateCanvasModes: {},
	statePatchPending: {},
	statePatchRequests: {},
	statePatchErrors: {},
	chartesCss: new Map(),
	chartesVersion: 0,
	collections: [],
	readOnly: false,
	selectedIds: [],
	editingElementId: null,
	showPopover: false,
	pending: [],
	activePanel: null,
	barPosition:
		(localStorage.getItem("bar-position") as "top" | "bottom") || "bottom",
	darkMode:
		localStorage.getItem("dark-mode") === "true" ||
		window.matchMedia("(prefers-color-scheme: dark)").matches,
	locked: false,
	zoom: 100,
	autoFocusFit: localStorage.getItem("maket-auto-focus-fit") !== "false",

	setConnected: (connected) => set({ connected }),
	setDocumentState: (docName, view) =>
		set((s) => {
			if (view) {
				return {
					documentStates: { ...s.documentStates, [docName]: view },
					stateCanvasModes: {
						...s.stateCanvasModes,
						[docName]: s.stateCanvasModes[docName] ?? "live",
					},
				};
			}
			const { [docName]: _state, ...documentStates } = s.documentStates;
			const { [docName]: _mode, ...stateCanvasModes } = s.stateCanvasModes;
			const prefix = `${docName}\u0000`;
			const statePatchPending = Object.fromEntries(
				Object.entries(s.statePatchPending).filter(
					([key]) => !key.startsWith(prefix),
				),
			);
			const statePatchErrors = Object.fromEntries(
				Object.entries(s.statePatchErrors).filter(
					([key]) => !key.startsWith(prefix),
				),
			);
			const statePatchRequests = Object.fromEntries(
				Object.entries(s.statePatchRequests).filter(
					([, key]) => !key.startsWith(prefix),
				),
			);
			return {
				documentStates,
				stateCanvasModes,
				statePatchPending,
				statePatchRequests,
				statePatchErrors,
			};
		}),
	applyStatePages: (docName, pages, view, docList) =>
		set((s) => {
			const current = s.docs.get(docName);
			if (!current) {
				return {
					documentStates: { ...s.documentStates, [docName]: view },
					docList,
				};
			}
			const nextPages = [...current.pages];
			for (const projection of pages) {
				const page = nextPages[projection.index];
				if (!page) continue;
				nextPages[projection.index] = { ...page, html: projection.html };
			}
			const docs = new Map(s.docs);
			docs.set(docName, { ...current, pages: nextPages });
			return {
				docs,
				docList,
				documentStates: { ...s.documentStates, [docName]: view },
			};
		}),
	setStateCanvasMode: (docName, mode) =>
		set((s) => ({
			stateCanvasModes: { ...s.stateCanvasModes, [docName]: mode },
			selectedIds: [],
			editingElementId: null,
		})),
	beginStatePatch: (docName, pointer, requestId) =>
		set((s) => {
			const key = statePatchKey(docName, pointer);
			const { [key]: _previousError, ...statePatchErrors } = s.statePatchErrors;
			return {
				statePatchPending: { ...s.statePatchPending, [key]: requestId },
				statePatchRequests: { ...s.statePatchRequests, [requestId]: key },
				statePatchErrors,
			};
		}),
	timeoutStatePatch: (requestId, error) =>
		set((s) => {
			const key = s.statePatchRequests[requestId];
			if (!key || s.statePatchPending[key] !== requestId) return {};
			const { [key]: _pending, ...statePatchPending } = s.statePatchPending;
			return {
				statePatchPending,
				statePatchErrors: { ...s.statePatchErrors, [key]: error },
			};
		}),
	settleStatePatch: (requestId, error) =>
		set((s) => {
			const key = s.statePatchRequests[requestId];
			if (!key) return {};
			const { [requestId]: _request, ...statePatchRequests } =
				s.statePatchRequests;
			const newerRequest = s.statePatchPending[key];
			if (newerRequest && newerRequest !== requestId) {
				return { statePatchRequests };
			}
			const { [key]: _pending, ...statePatchPending } = s.statePatchPending;
			if (error) {
				return {
					statePatchPending,
					statePatchRequests,
					statePatchErrors: { ...s.statePatchErrors, [key]: error },
				};
			}
			const { [key]: _previousError, ...statePatchErrors } = s.statePatchErrors;
			return { statePatchPending, statePatchRequests, statePatchErrors };
		}),
	clearStatePatches: () =>
		set({
			statePatchPending: {},
			statePatchRequests: {},
			statePatchErrors: {},
		}),
	setCollections: (collections) => {
		const s = get();
		const collectionDrafts = reconcileCollectionDrafts(
			s.collectionDrafts,
			collections,
		);
		const { kept, promoted } = reconcileDraftCursorOverrides(
			s.draftCursorOverrides,
			collections,
			collectionDrafts,
		);
		set({ collections, collectionDrafts, draftCursorOverrides: kept });
		// A previewed draft row that just got saved becomes the shared cursor.
		for (const override of promoted) {
			wsSend({
				type: "collection_cursor_set",
				docName: override.docName,
				pageIndex: override.pageIndex,
				memberId: override.memberId,
			});
		}
	},
	setDraftCursorOverride: (docName, pageIndex, memberId) =>
		set((s) => {
			const key = collectionCursorKey(docName, pageIndex);
			if (memberId === null) {
				const { [key]: _removed, ...draftCursorOverrides } =
					s.draftCursorOverrides;
				return { draftCursorOverrides };
			}
			return {
				draftCursorOverrides: {
					...s.draftCursorOverrides,
					[key]: { docName, pageIndex, memberId },
				},
			};
		}),
	setCollectionCursors: (cursors) =>
		set({
			collectionCursors: Object.fromEntries(
				cursors.map((cursor) => [
					collectionCursorKey(cursor.docName, cursor.pageIndex),
					cursor,
				]),
			),
		}),
	setFocusedCollection: (focusedCollectionName) =>
		set((s) => {
			// Closing a pinned view means "don't bring it back": unpin.
			const dataViewPinned = focusedCollectionName ? s.dataViewPinned : false;
			persistDataViewPin(dataViewPinned, focusedCollectionName);
			return { focusedCollectionName, dataViewPinned, selectedIds: [] };
		}),
	toggleDataViewPinned: () =>
		set((s) => {
			const dataViewPinned = !s.dataViewPinned;
			persistDataViewPin(dataViewPinned, s.focusedCollectionName);
			return { dataViewPinned };
		}),
	setCollectionDraft: (collection) =>
		set((s) => ({
			collectionDrafts: {
				...s.collectionDrafts,
				[collection.name]: collection,
			},
		})),
	clearCollectionDraft: (name) => {
		const s = get();
		const { [name]: _removed, ...collectionDrafts } = s.collectionDrafts;
		// Discarding a draft also discards local previews of its unsaved rows.
		const { kept } = reconcileDraftCursorOverrides(
			s.draftCursorOverrides,
			s.collections,
			collectionDrafts,
		);
		set({ collectionDrafts, draftCursorOverrides: kept });
	},
	// Cursor mutations go through the server (single source of truth); the
	// mirror updates when the `collection_cursors` broadcast comes back.
	setCursorMode: (docName, pageIndex, mode) =>
		wsSend({ type: "collection_cursor_set", docName, pageIndex, mode }),
	setCursorMember: (docName, pageIndex, memberId) =>
		wsSend({ type: "collection_cursor_set", docName, pageIndex, memberId }),
	moveCursorMember: (docName, pageIndex, delta) => {
		const s = get();
		const cursor = cursorForPage(s, docName, pageIndex);
		if (!cursor) return;
		const members = sortedCollectionMembers(
			s.collections.find((item) => item.name === cursor.collection),
		);
		if (members.length === 0) return;
		const currentIndex = Math.max(
			0,
			members.findIndex((member) => member.id === cursor.memberId),
		);
		const nextIndex = Math.min(
			members.length - 1,
			Math.max(0, currentIndex + delta),
		);
		const memberId = members[nextIndex]?.id ?? null;
		if (memberId === cursor.memberId) return;
		wsSend({ type: "collection_cursor_set", docName, pageIndex, memberId });
	},

	upsertDoc: (doc, docList, charteCss, addToWorkspace = true, focus = false) =>
		set((s) => {
			const previousFocusedDoc = s.docs.get(s.focusedDocName ?? "");
			const docs = new Map(s.docs);
			docs.set(doc.name, doc);
			const inWorkspace = s.workspaceDocNames.includes(doc.name);
			let workspaceDocNames = s.workspaceDocNames;
			if (!inWorkspace && addToWorkspace) {
				// Insert near same-category docs, or before focused doc
				const newCat = docList.find((d) => d.name === doc.name)?.category;
				const sameCatIdxs = s.workspaceDocNames
					.map((n, i) => ({ n, i }))
					.filter(
						({ n }) => docList.find((d) => d.name === n)?.category === newCat,
					)
					.map(({ i }) => i);
				const insertAfter =
					sameCatIdxs.length > 0
						? Math.max(...sameCatIdxs)
						: s.focusedDocName
							? s.workspaceDocNames.indexOf(s.focusedDocName) - 1
							: s.workspaceDocNames.length - 1;
				const pos = insertAfter + 1;
				workspaceDocNames = [
					...s.workspaceDocNames.slice(0, pos),
					doc.name,
					...s.workspaceDocNames.slice(pos),
				];
			}
			// Explicit focus (server-initiated) always wins. Otherwise auto-focus
			// only on the first doc added when nothing was focused yet.
			let focusedDocName: string | null;
			if (focus) {
				focusedDocName = doc.name;
			} else if (!inWorkspace && addToWorkspace && !s.focusedDocName) {
				focusedDocName = doc.name;
			} else {
				focusedDocName =
					s.focusedDocName ?? (workspaceDocNames.length > 0 ? doc.name : null);
			}
			const focusedPageIndex =
				focusedDocName === doc.name &&
				(focus || focusedDocName !== s.focusedDocName)
					? clampPageIndex(doc, doc.activePage)
					: preservePageIndex(
							previousFocusedDoc,
							docs.get(focusedDocName ?? ""),
							s.focusedPageIndex,
						);
			const chartesCss = new Map(s.chartesCss);
			if (charteCss !== undefined) chartesCss.set(doc.name, charteCss);
			saveWorkspace(workspaceDocNames);
			syncWorkspace();
			if (focusedDocName) saveFocusedDoc(focusedDocName);
			return {
				docs,
				workspaceDocNames,
				focusedDocName,
				focusedPageIndex,
				docList,
				chartesCss,
			};
		}),

	addDocToWorkspace: (docName) =>
		set((s) => {
			if (s.workspaceDocNames.includes(docName)) return {};
			const workspaceDocNames = [...s.workspaceDocNames, docName];
			saveWorkspace(workspaceDocNames);
			return { workspaceDocNames };
		}),

	removeDocFromWorkspace: (docName) =>
		set((s) => {
			const workspaceDocNames = s.workspaceDocNames.filter(
				(n) => n !== docName,
			);
			saveWorkspace(workspaceDocNames);
			syncWorkspace();
			const docs = new Map(s.docs);
			docs.delete(docName);
			const focusedDocName =
				s.focusedDocName === docName
					? (workspaceDocNames[workspaceDocNames.length - 1] ?? null)
					: s.focusedDocName;
			const focusChanged = focusedDocName !== s.focusedDocName;
			const focusedPageIndex = clampPageIndex(
				docs.get(focusedDocName ?? ""),
				focusChanged
					? (docs.get(focusedDocName ?? "")?.activePage ?? 0)
					: s.focusedPageIndex,
			);
			return {
				workspaceDocNames,
				docs,
				focusedDocName,
				focusedPageIndex,
				selectedIds: focusChanged ? [] : s.selectedIds,
			};
		}),

	setFocusedDoc: (docName) =>
		set((s) => {
			if (s.focusedDocName === docName) return {};
			saveFocusedDoc(docName ?? "");
			return {
				focusedDocName: docName,
				focusedPageIndex: clampPageIndex(
					s.docs.get(docName ?? ""),
					s.docs.get(docName ?? "")?.activePage ?? 0,
				),
				selectedIds: [],
			};
		}),

	setFocusedPage: (docName, pageIndex) =>
		set((s) => {
			const focusedPageIndex = clampPageIndex(s.docs.get(docName), pageIndex);
			if (
				s.focusedDocName === docName &&
				s.focusedPageIndex === focusedPageIndex
			) {
				return {};
			}
			saveFocusedDoc(docName);
			return {
				focusedDocName: docName,
				focusedPageIndex,
				selectedIds: [],
			};
		}),

	selectElement: (id, toggle = false) =>
		set((s) => {
			if (!id) return { selectedIds: [], showPopover: false };
			if (toggle) {
				const has = s.selectedIds.includes(id);
				return {
					selectedIds: has
						? s.selectedIds.filter((x) => x !== id)
						: [...s.selectedIds, id],
					showPopover: false,
				};
			}
			return { selectedIds: [id], showPopover: false };
		}),

	setEditingElement: (id) => set({ editingElementId: id }),

	setActivePanel: (activePanel) => set({ activePanel }),
	togglePanel: (panel) =>
		set((s) => ({ activePanel: s.activePanel === panel ? null : panel })),
	setBarPosition: (barPosition) => {
		localStorage.setItem("bar-position", barPosition);
		set({ barPosition });
	},
	setDarkMode: (darkMode) => {
		localStorage.setItem("dark-mode", String(darkMode));
		document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
		set({ darkMode });
	},
	toggleDarkMode: () => {
		const next = !get().darkMode;
		localStorage.setItem("dark-mode", String(next));
		document.documentElement.style.colorScheme = next ? "dark" : "light";
		set({ darkMode: next });
	},
	setLocked: (locked) => set({ locked }),
	setZoom: (zoom) => set({ zoom }),
	toggleAutoFocusFit: () => {
		const next = !get().autoFocusFit;
		localStorage.setItem("maket-auto-focus-fit", String(next));
		set({ autoFocusFit: next });
	},
	addPending: (msg) => {
		set((s) => {
			// Only inject focusedDocName when the caller did NOT specify the
			// docName key. An explicit `docName: undefined` means the caller
			// wants a workspace-scoped message (e.g. classify-images alerts
			// that should appear in the workspace bucket regardless of focus).
			const docName =
				"docName" in msg ? msg.docName : (s.focusedDocName ?? undefined);
			return { pending: [...s.pending, { ...msg, docName }] };
		});
		syncPending();
	},
	removePending: (id) => {
		set((s) => ({ pending: s.pending.filter((m) => m.id !== id) }));
		syncPending();
	},

	// Deprecated — calls upsertDoc for backward compat
	setServerState: (doc, docList, charteCss) => {
		if (doc) get().upsertDoc(doc, docList, charteCss);
		else set({ docList });
	},
}));

// ---- Selectors ----

/** The focused document (what BottomBar, Layers, Exchange operate on) */
export const useFocusedDoc = () =>
	useStore(
		useShallow((s) =>
			s.focusedDocName ? (s.docs.get(s.focusedDocName) ?? null) : null,
		),
	);

/** Workspace doc names (stable array ref via shallow compare) */
export const useWorkspaceDocNames = () =>
	useStore(useShallow((s) => s.workspaceDocNames));

/** Get a single doc by name (for WorkspaceDoc component) */
export function useDocByName(name: string) {
	return useStore(useShallow((s) => s.docs.get(name) ?? null));
}

/** Effective cursor of a page (null when the page has no data source). */
export function useCursorFor(docName: string | null, pageIndex: number) {
	return useStore(
		useShallow((s) => (docName ? cursorForPage(s, docName, pageIndex) : null)),
	);
}
