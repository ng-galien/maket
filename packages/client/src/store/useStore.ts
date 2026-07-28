import type { Collection } from "@maket/shared";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import type { DocSummary, Document } from "./types";
import { wsSend } from "./ws";

export type CollectionPreviewMode = "template" | "rendered" | "all";

export interface CollectionPreviewState {
	mode: CollectionPreviewMode;
	memberId: string | null;
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
	collectionPreview: Record<string, CollectionPreviewState>;
	collections: Collection[];
	collectionDrafts: Record<string, Collection>;
	setCollections: (collections: Collection[]) => void;
	setFocusedCollection: (name: string | null) => void;
	setCollectionDraft: (collection: Collection) => void;
	clearCollectionDraft: (name: string) => void;
	setCollectionPreviewMode: (
		collectionName: string,
		mode: CollectionPreviewMode,
	) => void;
	setCollectionPreviewMember: (
		collectionName: string,
		memberId: string | null,
	) => void;
	moveCollectionPreviewMember: (collectionName: string, delta: number) => void;
}

interface AppState extends CollectionSlice {
	// Connection
	connected: boolean;

	// Multi-doc workspace
	docs: Map<string, Document>;
	workspaceDocNames: string[];
	focusedDocName: string | null;

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

function reconcileCollectionPreview(
	current: Record<string, CollectionPreviewState>,
	collections: readonly Collection[],
): Record<string, CollectionPreviewState> {
	return Object.fromEntries(
		collections.map((collection) => [
			collection.name,
			previewFor(current, collections, collection.name),
		]),
	);
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

function collectionsWithDrafts(
	collections: readonly Collection[],
	drafts: Record<string, Collection>,
): Collection[] {
	return collections.map((collection) => drafts[collection.name] ?? collection);
}

function previewFor(
	current: Record<string, CollectionPreviewState>,
	collections: readonly Collection[],
	collectionName: string,
): CollectionPreviewState {
	const collection = collections.find((item) => item.name === collectionName);
	const existing = current[collectionName];
	const members = sortedCollectionMembers(collection);
	const existingMember = members.find(
		(member) => member.id === existing?.memberId,
	);
	return {
		mode: existing?.mode ?? "template",
		memberId: existingMember?.id ?? members[0]?.id ?? null,
	};
}

function movedPreview(
	current: Record<string, CollectionPreviewState>,
	collections: readonly Collection[],
	collectionName: string,
	delta: number,
): CollectionPreviewState {
	const preview = previewFor(current, collections, collectionName);
	const members = sortedCollectionMembers(
		collections.find((item) => item.name === collectionName),
	);
	if (members.length === 0) return { ...preview, memberId: null };
	const currentIndex = Math.max(
		0,
		members.findIndex((member) => member.id === preview.memberId),
	);
	const nextIndex = Math.min(
		members.length - 1,
		Math.max(0, currentIndex + delta),
	);
	return { ...preview, memberId: members[nextIndex]?.id ?? null };
}

function sortedCollectionMembers(collection: Collection | undefined) {
	return collection
		? [...collection.members].sort((a, b) => a.position - b.position)
		: [];
}

const _savedWorkspace = loadWorkspace();
const _savedFocused = localStorage.getItem("maket-focused-doc") || null;

export const useStore = create<AppState>((set, get) => ({
	connected: false,
	docs: new Map(),
	workspaceDocNames: _savedWorkspace,
	focusedDocName:
		_savedFocused && _savedWorkspace.includes(_savedFocused)
			? _savedFocused
			: null,
	focusedCollectionName: null,
	collectionPreview: {},
	collectionDrafts: {},
	docList: [],
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
	setCollections: (collections) =>
		set((s) => {
			const collectionDrafts = reconcileCollectionDrafts(
				s.collectionDrafts,
				collections,
			);
			return {
				collections,
				collectionDrafts,
				collectionPreview: reconcileCollectionPreview(
					s.collectionPreview,
					collectionsWithDrafts(collections, collectionDrafts),
				),
			};
		}),
	setFocusedCollection: (focusedCollectionName) =>
		set({ focusedCollectionName, selectedIds: [] }),
	setCollectionDraft: (collection) =>
		set((s) => ({
			collectionDrafts: {
				...s.collectionDrafts,
				[collection.name]: collection,
			},
			collectionPreview: reconcileCollectionPreview(s.collectionPreview, [
				...collectionsWithDrafts(s.collections, s.collectionDrafts).filter(
					(item) => item.name !== collection.name,
				),
				collection,
			]),
		})),
	clearCollectionDraft: (name) =>
		set((s) => {
			const { [name]: _removed, ...collectionDrafts } = s.collectionDrafts;
			return { collectionDrafts };
		}),
	setCollectionPreviewMode: (collectionName, mode) =>
		set((s) => ({
			collectionPreview: {
				...s.collectionPreview,
				[collectionName]: {
					...previewFor(
						s.collectionPreview,
						collectionsWithDrafts(s.collections, s.collectionDrafts),
						collectionName,
					),
					mode,
				},
			},
		})),
	setCollectionPreviewMember: (collectionName, memberId) =>
		set((s) => ({
			collectionPreview: {
				...s.collectionPreview,
				[collectionName]: {
					...previewFor(
						s.collectionPreview,
						collectionsWithDrafts(s.collections, s.collectionDrafts),
						collectionName,
					),
					memberId,
				},
			},
		})),
	moveCollectionPreviewMember: (collectionName, delta) =>
		set((s) => ({
			collectionPreview: {
				...s.collectionPreview,
				[collectionName]: movedPreview(
					s.collectionPreview,
					collectionsWithDrafts(s.collections, s.collectionDrafts),
					collectionName,
					delta,
				),
			},
		})),

	upsertDoc: (doc, docList, charteCss, addToWorkspace = true, focus = false) =>
		set((s) => {
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
			const chartesCss = new Map(s.chartesCss);
			if (charteCss !== undefined) chartesCss.set(doc.name, charteCss);
			saveWorkspace(workspaceDocNames);
			syncWorkspace();
			if (focusedDocName) saveFocusedDoc(focusedDocName);
			return { docs, workspaceDocNames, focusedDocName, docList, chartesCss };
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
			return {
				workspaceDocNames,
				docs,
				focusedDocName,
				selectedIds: focusedDocName !== s.focusedDocName ? [] : s.selectedIds,
			};
		}),

	setFocusedDoc: (docName) =>
		set((s) => {
			if (s.focusedDocName === docName) return {};
			saveFocusedDoc(docName ?? "");
			return {
				focusedDocName: docName,
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
