import type {
	StructuredWorkspaceCollectionRepresentation,
	StructuredWorkspacePinnedItem,
	StructuredWorkspaceView,
} from "@maket/shared";
import {
	FileText,
	MoreVertical,
	Pencil,
	Pin,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import {
	sendDeleteStructuredWorkspace,
	sendPinDoc,
	sendRenameStructuredWorkspace,
} from "../store/ws";
import { InlineNameEditor } from "./docs/DocMenu";
import { AnchoredMenu, AnchoredMenuItem } from "./shared/AnchoredMenu";
import { HoldToDelete } from "./shared/HoldToDelete";
import {
	LibraryCategoryHeader,
	libraryCategoryGuideOffset,
	libraryCategoryRowOffset,
} from "./shared/LibraryCategoryHeader";
import { LibraryToolbar, LibraryToolbarRow } from "./shared/LibraryToolbar";
import { showLibraryScrollActivity } from "./shared/libraryScroll";

interface CollectionNode {
	id: string;
	representation: StructuredWorkspaceCollectionRepresentation;
	documentName?: string;
	count: number;
	pinned: StructuredWorkspacePinnedItem[];
}

interface StructuredWorkspaceTreeModel {
	onNavigate?: () => void;
	query: string;
	setQuery: (query: string) => void;
	workspaceScope: StructuredWorkspaceView | undefined;
	clearWorkspaceScope: () => void;
	visibleWorkspaces: StructuredWorkspaceView[];
	workspaceCount: number;
	activeWorkspaceId: string | null;
	activeCollectionId: string | null;
	openNames: Set<string>;
	activateWorkspace: (workspace: StructuredWorkspaceView) => void;
	activateTemplate: (
		workspace: StructuredWorkspaceView,
		documentName: string,
	) => void;
	activateCollection: (
		workspace: StructuredWorkspaceView,
		collection: CollectionNode,
	) => void;
}

export function StructuredWorkspacesTab({
	onNavigate,
}: {
	onNavigate?: () => void;
}) {
	const model = useStructuredWorkspaceTree(onNavigate);
	const t = useT();
	return (
		<div
			data-structured-workspaces-list
			className="flex h-full min-h-0 flex-col"
		>
			<WorkspaceSearch query={model.query} setQuery={model.setQuery} />
			{model.workspaceScope && (
				<div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-text-2">
					<span className="min-w-0 flex-1 truncate">
						{t("workspace_scope", { workspace: model.workspaceScope.name })}
					</span>
					<button
						type="button"
						onClick={model.clearWorkspaceScope}
						aria-label={t("clear_workspace_scope")}
						className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-input hover:text-text-1"
					>
						<X size={13} />
					</button>
				</div>
			)}
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
function useStructuredWorkspaceTree(
	onNavigate?: () => void,
): StructuredWorkspaceTreeModel {
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
	const setStateDockOpen = useStore((state) => state.setStateDockOpen);
	const closeWorkspaceDocuments = useStore(
		(state) => state.closeWorkspaceDocuments,
	);
	const openWorkspaceDocument = useStore(
		(state) => state.openWorkspaceDocument,
	);
	const [query, setQuery] = useState("");
	const [workspaceScopeId, setWorkspaceScopeId] = useState<string | null>(null);
	const filterRequest = useStore(
		(state) => state.structuredWorkspaceFilterRequest,
	);
	const clearFilterRequest = useStore(
		(state) => state.clearStructuredWorkspaceFilterRequest,
	);
	useEffect(() => {
		if (!filterRequest) return;
		setQuery("");
		setWorkspaceScopeId(filterRequest.workspaceId);
		clearFilterRequest();
	}, [filterRequest, clearFilterRequest]);
	useEffect(() => {
		if (
			workspaceScopeId &&
			!workspaces.some((workspace) => workspace.id === workspaceScopeId)
		) {
			setWorkspaceScopeId(null);
		}
	}, [workspaces, workspaceScopeId]);
	const visibleWorkspaces = useMemo(
		() =>
			filterWorkspaces(
				workspaces.filter(
					(workspace) => !workspaceScopeId || workspace.id === workspaceScopeId,
				),
				query,
			),
		[query, workspaces, workspaceScopeId],
	);
	const openNames = new Set(openDocNames);
	const activateCollection = (
		workspace: StructuredWorkspaceView,
		collection: CollectionNode,
		dismissNavigation = true,
	) => {
		const collectionDocumentName = collection.documentName;
		if (workspace.integrity.status === "incomplete" || !collectionDocumentName)
			return;
		if (
			workspace.id !== activeWorkspaceId ||
			collection.id !== activeCollectionId
		) {
			closeWorkspaceDocuments(openDocNames, { returnToCollection: false });
			setActiveCollection(workspace.id, collection.id);
		}
		openWorkspaceDocument(collectionDocumentName, {
			workspaceId: workspace.id,
			collectionId: collection.id,
		});
		if (dismissNavigation) onNavigate?.();
	};
	return {
		onNavigate,
		query,
		setQuery,
		workspaceScope: workspaces.find(
			(workspace) => workspace.id === workspaceScopeId,
		),
		clearWorkspaceScope: () => setWorkspaceScopeId(null),
		visibleWorkspaces,
		workspaceCount: workspaces.length,
		activeWorkspaceId,
		activeCollectionId,
		openNames,
		activateWorkspace: (workspace) => {
			if (workspace.integrity.status === "incomplete") {
				closeWorkspaceDocuments(openDocNames, { returnToCollection: false });
				setActiveCollection(workspace.id, null);
				return;
			}
			const firstCollection = collectionNodes(workspace)[0];
			if (firstCollection)
				activateCollection(workspace, firstCollection, false);
		},
		activateTemplate: (workspace, documentName) => {
			if (workspace.id !== activeWorkspaceId) {
				closeWorkspaceDocuments(openDocNames, { returnToCollection: false });
				setActiveCollection(workspace.id, null);
			}
			openWorkspaceDocument(documentName, { workspaceId: workspace.id });
			setStateDockOpen(true);
		},
		activateCollection,
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
	const [mode, setMode] = useState<"idle" | "menu" | "rename" | "delete">(
		"idle",
	);
	const menuAnchor = useRef<HTMLButtonElement>(null);
	const collections = collectionNodes(workspace);
	const active = model.activeWorkspaceId === workspace.id;
	const openCount = useStore(
		(state) =>
			state.workspaceDocNames.filter((name) => {
				const owner = state.docs.get(name)?.meta?.structuredWorkspace;
				return owner?.role === "item" && owner.workspaceId === workspace.id;
			}).length,
	);
	return (
		<div data-structured-workspace={workspace.id}>
			{mode === "rename" ? (
				<InlineNameEditor
					initial={workspace.name}
					placeholder={t("structured_workspace_rename")}
					onCommit={(name) => {
						const trimmed = name.trim();
						setMode("idle");
						if (trimmed && trimmed !== workspace.name) {
							sendRenameStructuredWorkspace(
								workspace.id,
								trimmed,
								workspace.revision,
							);
						}
					}}
					onCancel={() => setMode("idle")}
				/>
			) : mode === "delete" ? (
				<HoldToDelete
					label={t("structured_workspace_delete_hold", {
						name: workspace.name,
					})}
					onConfirm={() => {
						setMode("idle");
						sendDeleteStructuredWorkspace(workspace.id);
					}}
					onCancel={() => setMode("idle")}
				/>
			) : (
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
					actions={
						<>
							<button
								ref={menuAnchor}
								type="button"
								aria-label={t("structured_workspace_menu")}
								onClick={() => setMode(mode === "menu" ? "idle" : "menu")}
								className="mr-1 grid h-7 w-7 place-items-center rounded-md text-text-3 opacity-0 transition hover:bg-black/[0.06] focus:opacity-100 group-hover/cat:opacity-100"
							>
								<MoreVertical size={15} />
							</button>
							{mode === "menu" && (
								<AnchoredMenu
									anchorRef={menuAnchor}
									onClose={() => setMode("idle")}
									ariaLabel={t("structured_workspace_menu")}
								>
									<AnchoredMenuItem
										icon={<Pencil size={14} />}
										onClick={() => setMode("rename")}
									>
										{t("doc_rename")}
									</AnchoredMenuItem>
									{workspace.templateDocuments.map((template) => (
										<AnchoredMenuItem
											key={template.documentId}
											icon={<FileText size={14} />}
											onClick={() => {
												setMode("idle");
												model.activateTemplate(
													workspace,
													template.documentName,
												);
											}}
										>
											{t("structured_template_open", {
												document: template.documentName,
											})}
										</AnchoredMenuItem>
									))}
									<AnchoredMenuItem
										icon={<Trash2 size={14} />}
										onClick={() => setMode("delete")}
										danger
									>
										{t("delete")}
									</AnchoredMenuItem>
								</AnchoredMenu>
							)}
						</>
					}
				/>
			)}
			{active && (
				<div className="relative">
					<TreeGuide depth={0} />
					{workspace.integrity.status === "incomplete" && (
						<div className="mx-8 mb-1 rounded-md bg-warning/10 px-2 py-1 text-xs text-text-2">
							{workspace.integrity.issues[0]}
						</div>
					)}
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
	const open = useStore((state) => state.openWorkspaceDocument);
	const readOnly = useStore((state) => state.readOnly);
	const active =
		workspace.id === model.activeWorkspaceId &&
		collection.id === model.activeCollectionId;
	const unavailable =
		workspace.integrity.status === "incomplete" || !collection.documentName;
	return (
		<div
			data-structured-collection={collection.id}
			data-active={active || undefined}
			data-category-path={`${workspace.name}/${collection.representation.name}`}
		>
			<button
				type="button"
				disabled={unavailable}
				aria-current={active ? "page" : undefined}
				aria-label={t("structured_collection_toggle", {
					collection: collection.representation.name,
				})}
				onClick={() => model.activateCollection(workspace, collection)}
				style={{ paddingLeft: libraryCategoryRowOffset(1) }}
				className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left text-sm disabled:opacity-50 ${active ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-input/70 hover:text-text-1"}`}
			>
				<span className="min-w-0 flex-1 truncate font-semibold">
					{collection.representation.name}
				</span>
				<span
					className="shrink-0 text-xs tabular-nums"
					title={t("structured_collection_item_count", {
						count: collection.count,
					})}
				>
					{collection.count}
				</span>
			</button>
			{collection.pinned.map((item) => (
				<div
					key={item.id}
					data-structured-item={item.id}
					className="flex min-w-0 items-center gap-1 rounded-md hover:bg-input/70"
					style={{ paddingLeft: libraryCategoryRowOffset(2) }}
				>
					<button
						type="button"
						disabled={unavailable}
						onClick={() => {
							open(item.documentName, {
								workspaceId: workspace.id,
								collectionId: collection.id,
							});
							model.onNavigate?.();
						}}
						className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left text-sm text-text-2"
					>
						<Pin size={13} className="shrink-0 text-accent" />
						<span className="truncate">{item.documentName}</span>
					</button>
					{!readOnly && (
						<button
							type="button"
							aria-label={t("unpin_document", { name: item.documentName })}
							onClick={() => sendPinDoc(item.documentName, false)}
							className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded text-text-3 hover:bg-input hover:text-text-1"
						>
							<Pin size={14} />
						</button>
					)}
				</div>
			))}
		</div>
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
	return Object.entries(workspace.representationSchema.collections).map(
		([id, representation]) => {
			const document = workspace.collectionDocuments.find(
				(candidate) => candidate.collectionId === id,
			);
			return {
				id,
				representation,
				documentName: document?.documentName,
				count: workspace.itemCounts[id] ?? 0,
				pinned: workspace.pinnedItems.filter(
					(item) => item.collectionId === id,
				),
			};
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
			...workspace.collectionDocuments.map((document) => document.documentName),
			...workspace.pinnedItems.map((item) => item.documentName),
		]
			.filter(Boolean)
			.join(" ")
			.toLocaleLowerCase()
			.includes(normalized),
	);
}
