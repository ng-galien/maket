import {
	type Collection,
	type CollectionCursorMode,
	listCollectionFields,
	listCollectionPlaceholders,
	type PageCollectionCursor,
} from "@maket/shared";
import { Code2, Database, Eye, FileStack } from "lucide-react";
import { useMemo } from "react";
import { useT } from "../i18n/useT";
import {
	cursorForPage,
	sortedCollectionMembers,
	useFocusedDoc,
	useStore,
} from "../store/useStore";

type Translate = ReturnType<typeof useT>;
type FieldUsage = "used" | "available";

interface FieldState {
	key: string;
	usage: FieldUsage;
}

/**
 * Header status and quick access only. Collection editing and preview controls
 * deliberately live in the bottom data workspace so there is one controller.
 */
// code-moniker: ignore[smell-feature-envy-local]
// This header adapter intentionally derives one compact status from the
// collection, document, cursor, and dock slices owned by the store.
export function CollectionDockButton() {
	const t = useT();
	const focusedDoc = useFocusedDoc();
	const pageIndex = useStore((state) => state.focusedPageIndex);
	const collections = useStore((state) => state.collections);
	const collectionDrafts = useStore((state) => state.collectionDrafts);
	const collectionCursors = useStore((state) => state.collectionCursors);
	const docs = useStore((state) => state.docs);
	const setFocusedCollection = useStore((state) => state.setFocusedCollection);
	const setDataDockMode = useStore((state) => state.setDataDockMode);
	const setLibraryView = useStore((state) => state.setLibraryView);
	const focusedCollectionName = useStore(
		(state) => state.focusedCollectionName,
	);
	const page = focusedDoc?.pages[pageIndex];
	const boundName = page?.collection?.name ?? "";
	const boundCollection = collections.find(
		(collection) => collection.name === boundName,
	);
	const visibleCollection = boundCollection
		? (collectionDrafts[boundCollection.name] ?? boundCollection)
		: null;
	const cursor = focusedDoc
		? cursorForPage(
				{ docs, collections, collectionDrafts, collectionCursors },
				focusedDoc.name,
				pageIndex,
			)
		: null;
	const members = sortedCollectionMembers(boundCollection);
	const memberPosition = cursor?.memberId
		? members.findIndex((member) => member.id === cursor.memberId) + 1
		: 0;
	const { unknownFields } = useMemo(
		() => fieldStates(page?.html, visibleCollection),
		[page?.html, visibleCollection],
	);

	if (!focusedDoc || !page || focusedDoc.dataModel === "state" || !boundName)
		return null;
	const missingCollection = Boolean(boundName && !boundCollection);
	const warning = missingCollection || unknownFields.length > 0;
	const active = focusedCollectionName === boundName;
	const label = triggerLabel(
		t,
		boundName,
		boundCollection ?? null,
		cursor,
		memberPosition,
		members.length,
	);

	const openDataWorkspace = () => {
		if (!boundCollection) {
			setLibraryView("collections");
			return;
		}
		if (active) {
			setFocusedCollection(null);
			return;
		}
		setDataDockMode("split");
		setFocusedCollection(boundCollection.name);
	};

	return (
		<button
			type="button"
			data-collection-dock-trigger
			aria-label={label}
			title={label}
			aria-pressed={active}
			onClick={openDataWorkspace}
			className={`relative -ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors ${
				active
					? "bg-accent-soft/70 text-accent"
					: "text-text-3 hover:bg-input/70 hover:text-text-1"
			}`}
		>
			<Database size={15} strokeWidth={1.6} />
			{warning && (
				<span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-panel" />
			)}
		</button>
	);
}

/** Rendering modes belong to the dock's first toolbar. Collection selection
 * and page binding stay in the Collections library, where sources live. */
// code-moniker: ignore[smell-feature-envy-local]
// This dock adapter intentionally projects the active page binding and cursor
// into the three render-mode actions without duplicating domain state.
export function CollectionRenderControls() {
	const focusedDoc = useFocusedDoc();
	const pageIndex = useStore((state) => state.focusedPageIndex);
	const collections = useStore((state) => state.collections);
	const collectionDrafts = useStore((state) => state.collectionDrafts);
	const collectionCursors = useStore((state) => state.collectionCursors);
	const docs = useStore((state) => state.docs);
	const setCursorMode = useStore((state) => state.setCursorMode);
	const focusedCollectionName = useStore(
		(state) => state.focusedCollectionName,
	);
	const page = focusedDoc?.pages[pageIndex];
	const boundName = page?.collection?.name ?? "";
	const boundCollection =
		collections.find((collection) => collection.name === boundName) ?? null;
	const members = useMemo(
		() => sortedCollectionMembers(boundCollection),
		[boundCollection],
	);
	const cursor = focusedDoc
		? cursorForPage(
				{ docs, collections, collectionDrafts, collectionCursors },
				focusedDoc.name,
				pageIndex,
			)
		: null;
	if (
		!focusedDoc ||
		!page ||
		focusedDoc.dataModel === "state" ||
		!boundCollection ||
		focusedCollectionName !== boundCollection.name ||
		!cursor
	) {
		return null;
	}

	return (
		<div data-collection-render-controls className="flex min-w-0 items-center">
			<CursorControls
				cursor={cursor}
				members={members}
				onMode={(mode) => setCursorMode(focusedDoc.name, pageIndex, mode)}
			/>
		</div>
	);
}

function CursorControls({
	cursor,
	members,
	onMode,
}: {
	cursor: PageCollectionCursor;
	members: Collection["members"];
	onMode: (mode: CollectionCursorMode) => void;
}) {
	const t = useT();
	return (
		<div
			className="ml-auto flex items-center gap-1"
			title={t("collection_cursor_shared")}
		>
			<div className="flex shrink-0 items-center rounded bg-input p-0.5">
				<ModeButton
					active={cursor.mode === "rendered"}
					title={t("collection_mode_rendered")}
					disabled={members.length === 0}
					onClick={() => onMode("rendered")}
					icon={<Eye size={14} />}
				/>
				<ModeButton
					active={cursor.mode === "all"}
					title={t("collection_mode_all")}
					disabled={members.length === 0}
					onClick={() => onMode("all")}
					icon={<FileStack size={14} />}
				/>
				<ModeButton
					active={cursor.mode === "template"}
					title={t("collection_mode_template")}
					onClick={() => onMode("template")}
					icon={<Code2 size={14} />}
				/>
			</div>
		</div>
	);
}

function ModeButton({
	active,
	title,
	icon,
	disabled = false,
	onClick,
}: {
	active: boolean;
	title: string;
	icon: React.ReactNode;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			className={`flex h-7 w-8 items-center justify-center rounded-sm transition-colors disabled:opacity-35 ${
				active
					? "bg-panel text-accent shadow-xs"
					: "text-text-3 hover:bg-panel/60 hover:text-text-1"
			}`}
		>
			{icon}
		</button>
	);
}

function fieldStates(
	html: string | undefined,
	collection: Collection | null,
): { fields: FieldState[]; unknownFields: string[] } {
	if (!collection) return { fields: [], unknownFields: [] };
	const knownKeys = new Set(
		listCollectionFields(collection).map((field) => field.key),
	);
	const usedNames = new Set<string>();
	for (const occurrence of safePlaceholders(html ?? "")) {
		if (occurrence.placeholder?.kind === "collectionField") {
			usedNames.add(occurrence.placeholder.field);
		}
	}
	return {
		fields: [...knownKeys].map((key) => ({
			key,
			usage: usedNames.has(key) ? "used" : "available",
		})),
		unknownFields: [...usedNames].filter((name) => !knownKeys.has(name)),
	};
}

function safePlaceholders(html: string) {
	try {
		return listCollectionPlaceholders(html);
	} catch {
		return [];
	}
}

function triggerLabel(
	t: Translate,
	boundName: string,
	boundCollection: Collection | null,
	cursor: PageCollectionCursor | null,
	memberPosition: number,
	memberCount: number,
): string {
	if (!boundCollection) return boundName || t("collection_link_data");
	if (cursor?.mode === "rendered" && memberPosition > 0) {
		return `${boundCollection.name} · ${t("collection_cursor_position", {
			index: memberPosition,
			total: memberCount,
		})}`;
	}
	if (cursor?.mode === "all") {
		return `${boundCollection.name} · ${t("collection_mode_all")}`;
	}
	return `${boundCollection.name} · ${t("collection_mode_template")}`;
}
