import type {
	StructuredWorkspaceCollectionRepresentation,
	StructuredWorkspaceItemView,
	StructuredWorkspaceView,
} from "@maket/shared";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import {
	LibraryCategoryHeader,
	libraryCategoryGuideOffset,
	libraryCategoryLabelOffset,
} from "./shared/LibraryCategoryHeader";
import { LibraryToolbar, LibraryToolbarRow } from "./shared/LibraryToolbar";
import { showLibraryScrollActivity } from "./shared/libraryScroll";

interface CollectionNode {
	id: string;
	representation: StructuredWorkspaceCollectionRepresentation;
	documentName: string;
	items: StructuredWorkspaceItemView[];
}

interface StructuredWorkspaceTreeModel {
	query: string;
	setQuery: (query: string) => void;
	visibleWorkspaces: StructuredWorkspaceView[];
	workspaceCount: number;
	activeWorkspaceId: string | null;
	activeCollectionId: string | null;
	openNames: Set<string>;
	collapsedCollections: Set<string>;
	activateWorkspace: (workspace: StructuredWorkspaceView) => void;
	toggleCollection: (key: string) => void;
	activateCollection: (
		workspace: StructuredWorkspaceView,
		collection: CollectionNode,
	) => void;
	toggleItem: (
		workspace: StructuredWorkspaceView,
		collection: CollectionNode,
		item: StructuredWorkspaceItemView,
	) => void;
}

export function StructuredWorkspacesTab() {
	const model = useStructuredWorkspaceTree();
	const t = useT();
	return (
		<div
			data-structured-workspaces-list
			className="flex h-full min-h-0 flex-col"
		>
			<WorkspaceSearch query={model.query} setQuery={model.setQuery} />
			<div
				data-structured-workspaces-scroll
				onScroll={showLibraryScrollActivity}
				className="library-scroll-area min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2.5"
			>
				{model.visibleWorkspaces.map((workspace) => (
					<StructuredWorkspaceNode
						key={workspace.id}
						workspace={workspace}
						model={model}
					/>
				))}
				{model.visibleWorkspaces.length === 0 && (
					<div className="px-4 py-6 text-center text-base text-text-3">
						{model.workspaceCount === 0
							? t("structured_workspace_none")
							: t("structured_workspace_no_match")}
					</div>
				)}
			</div>
		</div>
	);
}

// Client composition boundary between the authoritative server snapshot,
// the shared document workspace and this domain-specific tree.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
function useStructuredWorkspaceTree(): StructuredWorkspaceTreeModel {
	const workspaces = useStore((state) => state.structuredWorkspaces);
	const openDocNames = useStore((state) => state.workspaceDocNames);
	const activeWorkspaceId = useStore(
		(state) => state.activeStructuredWorkspaceId,
	);
	const activeCollectionId = useStore(
		(state) => state.activeStructuredCollectionId,
	);
	const setActiveCollection = useStore(
		(state) => state.setActiveStructuredCollection,
	);
	const closeWorkspaceDocuments = useStore(
		(state) => state.closeWorkspaceDocuments,
	);
	const openWorkspaceDocument = useStore(
		(state) => state.openWorkspaceDocument,
	);
	const [query, setQuery] = useState("");
	const [collapsedCollections, setCollapsedCollections] = useState<Set<string>>(
		new Set(),
	);
	const visibleWorkspaces = useMemo(
		() => filterWorkspaces(workspaces, query),
		[query, workspaces],
	);
	const openNames = new Set(openDocNames);
	const activateCollection = (
		workspace: StructuredWorkspaceView,
		collection: CollectionNode,
	) => {
		const collectionDocumentName = collection.documentName;
		if (!collectionDocumentName) return;
		if (
			workspace.id !== activeWorkspaceId ||
			collection.id !== activeCollectionId
		) {
			closeWorkspaceDocuments(openDocNames);
			setActiveCollection(workspace.id, collection.id);
		}
		openWorkspaceDocument(collectionDocumentName, {
			workspaceId: workspace.id,
			collectionId: collection.id,
		});
	};
	return {
		query,
		setQuery,
		visibleWorkspaces,
		workspaceCount: workspaces.length,
		activeWorkspaceId,
		activeCollectionId,
		openNames,
		collapsedCollections,
		activateWorkspace: (workspace) => {
			const firstCollection = collectionNodes(workspace)[0];
			if (firstCollection) activateCollection(workspace, firstCollection);
		},
		toggleCollection: (key) =>
			setCollapsedCollections((current) => toggleInSet(current, key)),
		activateCollection,
		toggleItem: (workspace, collection, item) => {
			const active =
				workspace.id === activeWorkspaceId &&
				collection.id === activeCollectionId;
			if (!active) activateCollection(workspace, collection);
			if (openNames.has(item.documentName)) {
				closeWorkspaceDocuments([item.documentName]);
			} else {
				openWorkspaceDocument(item.documentName);
			}
		},
	};
}

function WorkspaceSearch({
	query,
	setQuery,
}: {
	query: string;
	setQuery: (query: string) => void;
}) {
	const t = useT();
	return (
		<LibraryToolbar>
			<LibraryToolbarRow>
				<div className="relative min-w-0 flex-1">
					<Search
						size={14}
						aria-hidden
						className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3"
					/>
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("structured_workspace_search")}
						aria-label={t("structured_workspace_search")}
						className="h-8 w-full rounded-md border border-border bg-input pl-8 pr-8 text-sm text-text-1 outline-none transition focus:border-accent"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							aria-label={t("clear_search")}
							className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-panel hover:text-text-1"
						>
							<X size={13} />
						</button>
					)}
				</div>
			</LibraryToolbarRow>
		</LibraryToolbar>
	);
}

function StructuredWorkspaceNode({
	workspace,
	model,
}: {
	workspace: StructuredWorkspaceView;
	model: StructuredWorkspaceTreeModel;
}) {
	const t = useT();
	const collections = collectionNodes(workspace);
	const active = model.activeWorkspaceId === workspace.id;
	const openCount = workspace.items.filter((item) =>
		model.openNames.has(item.documentName),
	).length;
	return (
		<div data-structured-workspace={workspace.id}>
			<LibraryCategoryHeader
				model={{
					name: workspace.name,
					path: workspace.name,
					depth: 0,
					total: collections.length,
					activeTotal: openCount,
					collapsed: !active,
					toggle: () => model.activateWorkspace(workspace),
				}}
				toggleLabel={t("structured_workspace_toggle", {
					workspace: workspace.name,
				})}
				countTitle={t("structured_workspace_collection_count", {
					count: collections.length,
				})}
			/>
			{active && (
				<div className="relative">
					<TreeGuide depth={0} />
					{collections.map((collection) => (
						<StructuredCollectionNode
							key={collection.id}
							workspace={workspace}
							collection={collection}
							model={model}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function StructuredCollectionNode({
	workspace,
	collection,
	model,
}: {
	workspace: StructuredWorkspaceView;
	collection: CollectionNode;
	model: StructuredWorkspaceTreeModel;
}) {
	const t = useT();
	const key = `${workspace.id}:${collection.id}`;
	const collapsed = model.collapsedCollections.has(key);
	const active =
		workspace.id === model.activeWorkspaceId &&
		collection.id === model.activeCollectionId;
	const collectionDocumentName = collection.documentName;
	const collectionDocumentOpen = model.openNames.has(collectionDocumentName);
	const activeTotal = collection.items.filter((item) =>
		model.openNames.has(item.documentName),
	).length;
	return (
		<div
			data-structured-collection={collection.id}
			data-active={active || undefined}
		>
			<LibraryCategoryHeader
				model={{
					name: collection.representation.name,
					path: `${workspace.name}/${collection.representation.name}`,
					depth: 1,
					total: collection.items.length,
					activeTotal,
					collapsed,
					toggle: () =>
						active && collectionDocumentOpen
							? model.toggleCollection(key)
							: model.activateCollection(workspace, collection),
				}}
				toggleLabel={t("structured_collection_toggle", {
					collection: collection.representation.name,
				})}
				countTitle={t("structured_collection_item_count", {
					count: collection.items.length,
				})}
			/>
			{!collapsed && (
				<div className="relative">
					<TreeGuide depth={1} />
					<div
						className="flex flex-col gap-px"
						style={{
							marginLeft: `${libraryCategoryLabelOffset(2) - 8}px`,
						}}
					>
						{collection.items.map((item) => (
							<StructuredItemRow
								key={item.id}
								item={item}
								open={model.openNames.has(item.documentName)}
								onToggle={() => model.toggleItem(workspace, collection, item)}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function StructuredItemRow({
	item,
	open,
	onToggle,
}: {
	item: StructuredWorkspaceItemView;
	open: boolean;
	onToggle: () => void;
}) {
	const t = useT();
	return (
		<button
			type="button"
			data-structured-item={item.id}
			data-open={open || undefined}
			onClick={onToggle}
			className={`group flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors ${
				open
					? "bg-accent-soft text-accent"
					: "text-text-2 hover:bg-input/70 hover:text-text-1"
			}`}
			aria-label={
				open
					? t("structured_item_close", { document: item.documentName })
					: t("structured_item_open", { document: item.documentName })
			}
		>
			<span className="min-w-0 flex-1 truncate text-sm font-medium">
				{item.documentName}
			</span>
			<span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-3 group-hover:text-text-2">
				{item.bindingId}
			</span>
		</button>
	);
}

function TreeGuide({ depth }: { depth: number }) {
	return (
		<div
			aria-hidden
			className="absolute bottom-2 top-0 w-px bg-border"
			style={{ left: `${libraryCategoryGuideOffset(depth)}px` }}
		/>
	);
}

function collectionNodes(workspace: StructuredWorkspaceView): CollectionNode[] {
	return Object.entries(workspace.representationSchema.collections).flatMap(
		([id, representation]) => {
			const document = workspace.collectionDocuments.find(
				(candidate) => candidate.collectionId === id,
			);
			if (!document) return [];
			return [
				{
					id,
					representation,
					documentName: document.documentName,
					items: workspace.items
						.filter((item) => item.collectionId === id)
						.sort((left, right) => left.position - right.position),
				},
			];
		},
	);
}

function filterWorkspaces(
	workspaces: StructuredWorkspaceView[],
	query: string,
): StructuredWorkspaceView[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) return workspaces;
	return workspaces.filter((workspace) =>
		[
			workspace.name,
			workspace.description,
			...Object.values(workspace.representationSchema.collections).map(
				(collection) => collection.name,
			),
			...workspace.items.map((item) => item.documentName),
		]
			.filter(Boolean)
			.join(" ")
			.toLocaleLowerCase()
			.includes(normalized),
	);
}

function toggleInSet(current: Set<string>, value: string): Set<string> {
	const next = new Set(current);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	return next;
}
