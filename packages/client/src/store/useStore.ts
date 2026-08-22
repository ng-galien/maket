import {
	type Collection,
	type CollectionCursorMode,
	collectionCursorKey,
	type DocumentStateClientView,
	type PageCollectionCursor,
} from "@maket/shared";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import {
	applyAccentColor,
	applyColorScheme,
	DEFAULT_ACCENT_COLOR,
	normalizeAccentColor,
	resolveDarkMode,
	type ThemeMode,
} from "../lib/colorScheme";
import type { DocSummary, Document } from "./types";
import {
	type AnnotationCreateOutcome,
	sendAnnotationCreate,
	sendLoadDoc,
	wsSend,
} from "./ws";
import { cancelFitForWorkspaceRemoval, requestFit } from "./zoomBridge";

export type CollectionPreviewMode = CollectionCursorMode;
export type StateCanvasMode = "live" | "design";
export type WorkspaceView = "canvas" | "reading";

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
	dataDockMode: "split" | "expanded";
	setDataDockMode: (mode: "split" | "expanded") => void;
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
	stateDockOpen: boolean;
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
	setStateDockOpen: (open: boolean) => void;
	beginStatePatch: (
		docName: string,
		pointer: string,
		requestId: string,
	) => void;
	timeoutStatePatch: (requestId: string, error: string) => void;
	settleStatePatch: (requestId: string, error?: string) => void;
	clearStatePatches: () => void;
}

interface DocumentIdentitySlice {
	replaceRenamedDoc: (
		oldName: string,
		doc: Document,
		docList: DocSummary[],
		charteCss: string,
		documentState?: DocumentStateClientView | null,
	) => void;
}

interface ShellSlice {
	libraryView: "chartes" | "photos" | "docs" | "collections" | "exchange";
	libraryOpen: boolean;
	settingsOpen: boolean;
	documentCategoryFilterRequest: { path: string } | null;
	workspaceView: WorkspaceView;
	themeMode: ThemeMode;
	darkMode: boolean;
	accentColor: string;
	setLibraryView: (view: ShellSlice["libraryView"]) => void;
	filterDocumentsByCategory: (path: string) => void;
	clearDocumentCategoryFilterRequest: () => void;
	toggleLibrary: () => void;
	closeLastPanel: () => void;
	toggleSettings: () => void;
	closeSettings: () => void;
	setWorkspaceView: (view: WorkspaceView) => void;
	setThemeMode: (mode: ThemeMode) => void;
	setDarkMode: (value: boolean) => void;
	toggleDarkMode: () => void;
	setAccentColor: (value: string) => void;
}

interface AppState
	extends CollectionSlice,
		DocumentStateSlice,
		DocumentIdentitySlice,
		ShellSlice {
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
	locked: boolean;
	zoom: number;
	autoFocusFit: boolean;

	// Pending messages (user → agent)
	pending: PendingMessage[];

	// Actions
	setConnected: (v: boolean) => void;
	upsertDoc: (
		doc: Document,
		docList: DocSummary[],
		charteCss?: string,
		addToWorkspace?: boolean,
		focus?: boolean,
		explicitFocus?: boolean,
	) => void;
	addDocToWorkspace: (docName: string) => void;
	closeWorkspaceDocuments: (docNames: string[]) => void;
	openWorkspaceDocument: (docName: string) => void;
	setFocusedDoc: (docName: string | null) => void;
	setFocusedPage: (docName: string, pageIndex: number) => void;
	selectElement: (id: string | null, toggle?: boolean) => void;
	setEditingElement: (id: string | null) => void;
	setLocked: (v: boolean) => void;
	setZoom: (v: number) => void;
	toggleAutoFocusFit: () => void;
	addPending: (msg: PendingMessage) => Promise<AnnotationCreateOutcome>;
	removePending: (id: string) => boolean;

	// Deprecated — backward compat
	setServerState: (
		doc: Document | null,
		docList: DocSummary[],
		charteCss?: string,
	) => void;
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

function loadThemeMode(): ThemeMode {
	const saved = localStorage.getItem("maket-theme-mode");
	if (saved === "system" || saved === "light" || saved === "dark") return saved;
	const legacy = localStorage.getItem("dark-mode");
	if (legacy === "true" || legacy === "false") {
		const migrated = legacy === "true" ? "dark" : "light";
		localStorage.setItem("maket-theme-mode", migrated);
		localStorage.removeItem("dark-mode");
		return migrated;
	}
	return "system";
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
 * same default the server would lazily create (single-row render, first row).
 * An empty collection remains in template mode because there is no row to
 * render yet.
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
		mode: collection?.members.length ? "rendered" : "template",
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

function resolveWorkspaceFocus(
	workspaceDocNames: readonly string[],
	requestedDocName: string | null,
	currentDocName: string | null,
	loadedDocs?: ReadonlyMap<string, unknown>,
): string | null {
	if (requestedDocName && workspaceDocNames.includes(requestedDocName)) {
		return requestedDocName;
	}
	if (currentDocName && workspaceDocNames.includes(currentDocName)) {
		return currentDocName;
	}
	if (loadedDocs) {
		for (let index = workspaceDocNames.length - 1; index >= 0; index -= 1) {
			const name = workspaceDocNames[index];
			if (name && loadedDocs.has(name)) return name;
		}
	}
	return workspaceDocNames[workspaceDocNames.length - 1] ?? null;
}

function collectionDockForFocus(
	state: Pick<AppState, "docs" | "dataDockMode" | "focusedCollectionName">,
	docName: string | null,
	pageIndex: number,
): Pick<AppState, "dataDockMode" | "focusedCollectionName"> {
	const collectionName = docName
		? state.docs.get(docName)?.pages[pageIndex]?.collection?.name
		: null;
	if (!collectionName) {
		return { dataDockMode: "split", focusedCollectionName: null };
	}
	if (state.focusedCollectionName === null) {
		return { dataDockMode: "split", focusedCollectionName: null };
	}
	return {
		dataDockMode: "split",
		focusedCollectionName: collectionName,
	};
}

function stateDockForFocus(
	state: Pick<AppState, "docs" | "stateDockOpen">,
	docName: string | null,
): Pick<AppState, "stateDockOpen"> {
	const document = docName ? state.docs.get(docName) : null;
	return {
		stateDockOpen: state.stateDockOpen && document?.dataModel === "state",
	};
}

const _savedWorkspace = loadWorkspace();
const _savedFocused = localStorage.getItem("maket-focused-doc") || null;
const _savedThemeMode = loadThemeMode();
const _savedAccentColor = normalizeAccentColor(
	localStorage.getItem("maket-accent-color") || DEFAULT_ACCENT_COLOR,
);
export const useStore = create<AppState>((set, get) => ({
	connected: false,
	docs: new Map(),
	workspaceDocNames: _savedWorkspace,
	focusedDocName: resolveWorkspaceFocus(_savedWorkspace, _savedFocused, null),
	focusedPageIndex: 0,
	focusedCollectionName: null,
	dataDockMode: "split",
	collectionCursors: {},
	draftCursorOverrides: {},
	collectionDrafts: {},
	docList: [],
	documentStates: {},
	stateCanvasModes: {},
	stateDockOpen: false,
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
	libraryView:
		(localStorage.getItem("maket-library-view") as
			| "chartes"
			| "photos"
			| "docs"
			| "collections"
			| "exchange") || "docs",
	libraryOpen: localStorage.getItem("maket-library-open") !== "false",
	settingsOpen: false,
	documentCategoryFilterRequest: null,
	workspaceView:
		localStorage.getItem("maket-workspace-view") === "reading"
			? "reading"
			: "canvas",
	themeMode: _savedThemeMode,
	darkMode: resolveDarkMode(_savedThemeMode),
	accentColor: _savedAccentColor,
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
				stateDockOpen: s.focusedDocName === docName ? false : s.stateDockOpen,
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
	setStateDockOpen: (stateDockOpen) =>
		set({
			stateDockOpen,
			focusedCollectionName: stateDockOpen ? null : get().focusedCollectionName,
			dataDockMode: stateDockOpen ? "split" : get().dataDockMode,
			selectedIds: [],
			editingElementId: null,
		}),
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
		set({
			focusedCollectionName,
			stateDockOpen: focusedCollectionName ? false : get().stateDockOpen,
			selectedIds: [],
		}),
	setDataDockMode: (dataDockMode) => set({ dataDockMode }),
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
	// Editor cursor mutations go through the server. The read-only standalone
	// viewer has no WebSocket, so its preview-only cursor is updated locally.
	setCursorMode: (docName, pageIndex, mode) => {
		const s = get();
		if (!s.readOnly) {
			wsSend({ type: "collection_cursor_set", docName, pageIndex, mode });
			return;
		}
		const cursor = cursorForPage(s, docName, pageIndex);
		if (!cursor) return;
		set({
			collectionCursors: {
				...s.collectionCursors,
				[collectionCursorKey(docName, pageIndex)]: { ...cursor, mode },
			},
		});
	},
	setCursorMember: (docName, pageIndex, memberId) => {
		const s = get();
		if (!s.readOnly) {
			wsSend({ type: "collection_cursor_set", docName, pageIndex, memberId });
			return;
		}
		const cursor = cursorForPage(s, docName, pageIndex);
		if (!cursor) return;
		set({
			collectionCursors: {
				...s.collectionCursors,
				[collectionCursorKey(docName, pageIndex)]: { ...cursor, memberId },
			},
		});
	},
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
		if (s.readOnly) {
			set({
				collectionCursors: {
					...s.collectionCursors,
					[collectionCursorKey(docName, pageIndex)]: {
						...cursor,
						memberId,
					},
				},
			});
			return;
		}
		wsSend({ type: "collection_cursor_set", docName, pageIndex, memberId });
	},

	upsertDoc: (
		doc,
		docList,
		charteCss,
		addToWorkspace = true,
		focus = false,
		explicitFocus = false,
	) =>
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
			// Reading is deliberately user-steady: server work may update or open
			// documents in the background, but must not replace the document being
			// read. Manual UI focus still goes through setFocusedDoc/setFocusedPage.
			const acceptServerFocus =
				focus && (s.workspaceView !== "reading" || explicitFocus);
			// Explicit focus normally wins. Otherwise auto-focus only on the first
			// document added when nothing was focused yet.
			let focusedDocName: string | null;
			if (acceptServerFocus) {
				focusedDocName = doc.name;
			} else if (!inWorkspace && addToWorkspace && !s.focusedDocName) {
				focusedDocName = doc.name;
			} else {
				focusedDocName = s.focusedDocName ?? (inWorkspace ? doc.name : null);
			}
			const focusedPageIndex =
				focusedDocName === doc.name &&
				(acceptServerFocus || focusedDocName !== s.focusedDocName)
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
			const focusChanged =
				focusedDocName !== s.focusedDocName ||
				focusedPageIndex !== s.focusedPageIndex;
			const collectionDock = focusChanged
				? collectionDockForFocus(
						{ ...s, docs },
						focusedDocName,
						focusedPageIndex,
					)
				: {
						dataDockMode: s.dataDockMode,
						focusedCollectionName: s.focusedCollectionName,
					};
			const stateDock = focusChanged
				? stateDockForFocus({ ...s, docs }, focusedDocName)
				: { stateDockOpen: s.stateDockOpen };
			return {
				docs,
				workspaceDocNames,
				focusedDocName,
				focusedPageIndex,
				...collectionDock,
				...stateDock,
				docList,
				chartesCss,
			};
		}),

	replaceRenamedDoc: (oldName, doc, docList, charteCss, documentState) =>
		set((s) => {
			const docs = new Map(s.docs);
			docs.delete(oldName);
			docs.set(doc.name, doc);
			const workspaceDocNames = [
				...new Set(
					s.workspaceDocNames.map((name) =>
						name === oldName ? doc.name : name,
					),
				),
			];
			const focusedDocName =
				s.focusedDocName === oldName ? doc.name : s.focusedDocName;
			const focusedPageIndex =
				s.focusedDocName === oldName
					? clampPageIndex(doc, s.focusedPageIndex)
					: s.focusedPageIndex;
			const chartesCss = new Map(s.chartesCss);
			chartesCss.delete(oldName);
			chartesCss.set(doc.name, charteCss);
			const documentStates = { ...s.documentStates };
			delete documentStates[oldName];
			if (documentState) documentStates[doc.name] = documentState;
			const stateCanvasModes = { ...s.stateCanvasModes };
			const oldCanvasMode = stateCanvasModes[oldName];
			delete stateCanvasModes[oldName];
			if (oldCanvasMode) stateCanvasModes[doc.name] = oldCanvasMode;
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
				documentStates,
				stateCanvasModes,
			};
		}),

	addDocToWorkspace: (docName) =>
		set((s) => {
			if (s.workspaceDocNames.includes(docName)) return {};
			const workspaceDocNames = [...s.workspaceDocNames, docName];
			const focusedDocName = resolveWorkspaceFocus(
				workspaceDocNames,
				s.focusedDocName,
				null,
			);
			const focusChanged = focusedDocName !== s.focusedDocName;
			const focusedPageIndex = focusChanged
				? clampPageIndex(
						s.docs.get(focusedDocName ?? ""),
						s.docs.get(focusedDocName ?? "")?.activePage ?? 0,
					)
				: s.focusedPageIndex;
			saveWorkspace(workspaceDocNames);
			if (focusChanged) saveFocusedDoc(focusedDocName ?? "");
			return {
				workspaceDocNames,
				focusedDocName,
				focusedPageIndex,
				selectedIds: focusChanged ? [] : s.selectedIds,
				...(focusChanged
					? collectionDockForFocus(s, focusedDocName, focusedPageIndex)
					: {}),
			};
		}),

	closeWorkspaceDocuments: (docNames) => {
		const names = new Set(docNames);
		if (names.size === 0) return;
		const current = get();
		const closesWorkspace = current.workspaceDocNames.some((name) =>
			names.has(name),
		);
		const closesLoadedDocument = [...names].some((name) =>
			current.docs.has(name),
		);
		if (!closesWorkspace && !closesLoadedDocument) return;
		if (closesWorkspace) cancelFitForWorkspaceRemoval();
		set((s) => {
			const workspaceDocNames = s.workspaceDocNames.filter(
				(name) => !names.has(name),
			);
			saveWorkspace(workspaceDocNames);
			const docs = new Map(s.docs);
			for (const name of names) docs.delete(name);
			const focusedDocName = resolveWorkspaceFocus(
				workspaceDocNames,
				s.focusedDocName && !names.has(s.focusedDocName)
					? s.focusedDocName
					: null,
				null,
				docs,
			);
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
				...collectionDockForFocus(
					{ ...s, docs },
					focusedDocName,
					focusedPageIndex,
				),
			};
		});
		if (closesWorkspace) {
			syncWorkspace();
			const next = get();
			saveFocusedDoc(next.focusedDocName ?? "");
			if (next.focusedDocName) {
				if (!next.docs.has(next.focusedDocName)) {
					wsSend({ type: "load_document", name: next.focusedDocName });
				}
				if (next.workspaceView === "canvas") {
					requestFit({
						docName: next.focusedDocName,
						pageIndex: next.focusedPageIndex,
					});
				}
			}
		}
	},

	openWorkspaceDocument: (docName) => {
		const state = get();
		if (!state.workspaceDocNames.includes(docName)) {
			sendLoadDoc(docName);
			return;
		}
		state.setFocusedDoc(docName);
		if (state.workspaceView === "canvas") requestFit({ docName });
	},

	setFocusedDoc: (docName) =>
		set((s) => {
			const focusedDocName = resolveWorkspaceFocus(
				s.workspaceDocNames,
				docName,
				s.focusedDocName,
			);
			const focusedPageIndex = clampPageIndex(
				s.docs.get(focusedDocName ?? ""),
				s.docs.get(focusedDocName ?? "")?.activePage ?? 0,
			);
			const collectionDock = collectionDockForFocus(
				s,
				focusedDocName,
				focusedPageIndex,
			);
			const stateDock = stateDockForFocus(s, focusedDocName);
			if (
				s.focusedDocName === focusedDocName &&
				s.focusedPageIndex === focusedPageIndex &&
				s.dataDockMode === collectionDock.dataDockMode &&
				s.focusedCollectionName === collectionDock.focusedCollectionName &&
				s.stateDockOpen === stateDock.stateDockOpen
			)
				return {};
			saveFocusedDoc(focusedDocName ?? "");
			return {
				focusedDocName,
				focusedPageIndex,
				selectedIds: s.focusedDocName === focusedDocName ? s.selectedIds : [],
				...collectionDock,
				...stateDock,
			};
		}),

	setFocusedPage: (docName, pageIndex) =>
		set((s) => {
			if (!s.workspaceDocNames.includes(docName)) return {};
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
				...collectionDockForFocus(s, docName, focusedPageIndex),
				...stateDockForFocus(s, docName),
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

	setLibraryView: (libraryView) => {
		localStorage.setItem("maket-library-view", libraryView);
		localStorage.setItem("maket-library-open", "true");
		set({ libraryView, libraryOpen: true, settingsOpen: false });
	},
	filterDocumentsByCategory: (path) => {
		localStorage.setItem("maket-library-view", "docs");
		localStorage.setItem("maket-library-open", "true");
		set({
			libraryView: "docs",
			libraryOpen: true,
			settingsOpen: false,
			documentCategoryFilterRequest: { path },
		});
	},
	clearDocumentCategoryFilterRequest: () =>
		set({ documentCategoryFilterRequest: null }),
	toggleLibrary: () =>
		set((s) => {
			const libraryOpen = s.settingsOpen ? true : !s.libraryOpen;
			localStorage.setItem("maket-library-open", String(libraryOpen));
			return { libraryOpen, settingsOpen: false };
		}),
	closeLastPanel: () =>
		set((s) => {
			if (s.settingsOpen) return { settingsOpen: false };
			if (s.libraryOpen) {
				localStorage.setItem("maket-library-open", "false");
				return { libraryOpen: false };
			}
			return {};
		}),
	toggleSettings: () =>
		set((s) => {
			const settingsOpen = !s.settingsOpen;
			if (settingsOpen) localStorage.setItem("maket-library-open", "false");
			return {
				settingsOpen,
				libraryOpen: settingsOpen ? false : s.libraryOpen,
			};
		}),
	closeSettings: () => set({ settingsOpen: false }),
	setWorkspaceView: (workspaceView) => {
		localStorage.setItem("maket-workspace-view", workspaceView);
		set({ workspaceView, settingsOpen: false });
	},
	setThemeMode: (themeMode) => {
		const darkMode = resolveDarkMode(themeMode);
		localStorage.setItem("maket-theme-mode", themeMode);
		applyColorScheme(darkMode);
		set({ themeMode, darkMode });
	},
	setDarkMode: (darkMode) => {
		const themeMode = darkMode ? "dark" : "light";
		localStorage.setItem("maket-theme-mode", themeMode);
		applyColorScheme(darkMode);
		set({ themeMode, darkMode });
	},
	toggleDarkMode: () => {
		const next = !get().darkMode;
		const themeMode = next ? "dark" : "light";
		localStorage.setItem("maket-theme-mode", themeMode);
		applyColorScheme(next);
		set({ themeMode, darkMode: next });
	},
	setAccentColor: (value) => {
		const accentColor = normalizeAccentColor(value);
		localStorage.setItem("maket-accent-color", accentColor);
		applyAccentColor(accentColor);
		set({ accentColor });
	},
	setLocked: (locked) => set({ locked }),
	setZoom: (zoom) => set({ zoom }),
	toggleAutoFocusFit: () => {
		const next = !get().autoFocusFit;
		localStorage.setItem("maket-auto-focus-fit", String(next));
		set({ autoFocusFit: next });
	},
	addPending: (msg) => {
		const state = get();
		const docName =
			"docName" in msg ? msg.docName : (state.focusedDocName ?? undefined);
		return sendAnnotationCreate({ ...msg, docName });
	},
	removePending: (id) => {
		return wsSend({ type: "annotation_remove", id });
	},

	// Deprecated — calls upsertDoc for backward compat
	setServerState: (doc, docList, charteCss) => {
		if (doc) get().upsertDoc(doc, docList, charteCss);
		else set({ docList });
	},
}));

// ---- Selectors ----

/** The focused document (what the workspace header, canvas and exchanges operate on) */
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
