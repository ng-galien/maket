import type {
	StructuredWorkspaceCollectionRepresentation,
	StructuredWorkspaceItemView,
	StructuredWorkspaceTemplateDocumentView,
	StructuredWorkspaceView,
} from "@maket/shared";
import {
	ChevronDown,
	ChevronRight,
	MoreVertical,
	Pencil,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import {
	sendDeleteStructuredWorkspace,
	sendRenameStructuredWorkspace,
} from "../store/ws";
import { InlineNameEditor } from "./docs/DocMenu";
import { AnchoredMenu, AnchoredMenuItem } from "./shared/AnchoredMenu";
import { HoldToDelete } from "./shared/HoldToDelete";
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
	documentName?: string;
	templates: CollectionTemplateNode[];
	items: StructuredWorkspaceItemView[];
}

interface CollectionTemplateNode {
	documentId: string;
	documentName: string;
	roles: StructuredWorkspaceTemplateDocumentView["roles"];
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
	collapsedDefinitions: Set<string>;
	activateWorkspace: (workspace: StructuredWorkspaceView) => void;
	activateTemplate: (
		workspace: StructuredWorkspaceView,
		documentName: string,
	) => void;
	toggleCollection: (key: string) => void;
	toggleDefinition: (key: string) => void;
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
	const setStateDockOpen = useStore((state) => state.setStateDockOpen);
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
	const [collapsedDefinitions, setCollapsedDefinitions] = useState<Set<string>>(
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
		if (workspace.integrity.status === "incomplete" || !collectionDocumentName)
			return;
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
		collapsedDefinitions,
		activateWorkspace: (workspace) => {
			if (workspace.integrity.status === "incomplete") {
				closeWorkspaceDocuments(openDocNames);
				setActiveCollection(workspace.id, null);
				const template = workspace.templateDocuments[0];
				if (template) {
					openWorkspaceDocument(template.documentName, {
						workspaceId: workspace.id,
					});
					setStateDockOpen(true);
				}
				return;
			}
			const firstCollection = collectionNodes(workspace)[0];
			if (firstCollection) activateCollection(workspace, firstCollection);
		},
		activateTemplate: (workspace, documentName) => {
			if (workspace.id !== activeWorkspaceId) {
				closeWorkspaceDocuments(openDocNames);
				setActiveCollection(workspace.id, null);
			}
			openWorkspaceDocument(documentName, { workspaceId: workspace.id });
			setStateDockOpen(true);
		},
		toggleCollection: (key) =>
			setCollapsedCollections((current) => toggleInSet(current, key)),
		toggleDefinition: (key) =>
			setCollapsedDefinitions((current) => toggleInSet(current, key)),
		activateCollection,
		toggleItem: (workspace, collection, item) => {
			const active =
				workspace.id === activeWorkspaceId &&
				collection.id === activeCollectionId;
			if (!active) activateCollection(workspace, collection);
			if (openNames.has(item.documentName)) {
				closeWorkspaceDocuments([item.documentName]);
			} else {
				openWorkspaceDocument(item.documentName, {
					workspaceId: workspace.id,
					collectionId: collection.id,
				});
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
	const [mode, setMode] = useState<"idle" | "menu" | "rename" | "delete">(
		"idle",
	);
	const menuAnchor = useRef<HTMLButtonElement>(null);
	const collections = collectionNodes(workspace);
	const active = model.activeWorkspaceId === workspace.id;
	const openCount = workspace.items.filter((item) =>
		model.openNames.has(item.documentName),
	).length;
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
	const key = `${workspace.id}:${collection.id}`;
	const definitionKey = `${key}:definition`;
	const collapsed = model.collapsedCollections.has(key);
	const definitionCollapsed = model.collapsedDefinitions.has(definitionKey);
	const active =
		workspace.id === model.activeWorkspaceId &&
		collection.id === model.activeCollectionId;
	const collectionDocumentOpen = collection.documentName
		? model.openNames.has(collection.documentName)
		: false;
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
					toggle: () => {
						if (
							workspace.integrity.status === "incomplete" ||
							!collection.documentName ||
							(active && collectionDocumentOpen)
						) {
							model.toggleCollection(key);
							return;
						}
						model.activateCollection(workspace, collection);
					},
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
						<StructuredCollectionDefinition
							collapsed={definitionCollapsed}
							templates={collection.templates}
							openNames={model.openNames}
							onToggle={() => model.toggleDefinition(definitionKey)}
							onOpen={(documentName) =>
								model.activateTemplate(workspace, documentName)
							}
						/>
						{workspace.integrity.status === "ready" &&
							collection.items.map((item) => (
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

function StructuredTemplateRow({
	documentName,
	roles,
	open,
	onOpen,
}: {
	documentName: string;
	roles: StructuredWorkspaceTemplateDocumentView["roles"];
	open: boolean;
	onOpen: () => void;
}) {
	const t = useT();
	return (
		<button
			type="button"
			data-structured-template={documentName}
			data-open={open || undefined}
			onClick={onOpen}
			className={`ml-8 flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors ${
				open
					? "bg-accent-soft text-accent"
					: "text-text-2 hover:bg-input/70 hover:text-text-1"
			}`}
			aria-label={t("structured_template_open", { document: documentName })}
		>
			<span className="min-w-0 flex-1 truncate text-sm font-medium">
				{documentName}
			</span>
			<span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-3">
				{templateRoleLabel(roles, t)}
			</span>
		</button>
	);
}

function StructuredCollectionDefinition({
	collapsed,
	templates,
	openNames,
	onToggle,
	onOpen,
}: {
	collapsed: boolean;
	templates: CollectionTemplateNode[];
	openNames: ReadonlySet<string>;
	onToggle: () => void;
	onOpen: (documentName: string) => void;
}) {
	const t = useT();
	return (
		<div data-structured-definition>
			<button
				type="button"
				aria-expanded={!collapsed}
				onClick={onToggle}
				className="flex min-h-8 w-full items-center gap-1 rounded-md px-2 text-left text-sm font-medium text-text-2 transition-colors hover:bg-input/70 hover:text-text-1"
			>
				{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
				{t("structured_definition")}
			</button>
			{!collapsed && (
				<div className="ml-4 flex flex-col gap-px">
					{templates.map((template) => (
						<StructuredTemplateRow
							key={template.documentId}
							documentName={template.documentName}
							roles={template.roles}
							open={openNames.has(template.documentName)}
							onOpen={() => onOpen(template.documentName)}
						/>
					))}
				</div>
			)}
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
				templates: workspace.templateDocuments.flatMap((template) => {
					const roles = template.roles
						.filter((role) => role.collectionId === id)
						.sort(compareTemplateRoles);
					return roles.length > 0 ? [{ ...template, roles }] : [];
				}),
				items: workspace.items
					.filter((item) => item.collectionId === id)
					.sort((left, right) => left.position - right.position),
			};
		},
	);
}

function compareTemplateRoles(
	left: StructuredWorkspaceTemplateDocumentView["roles"][number],
	right: StructuredWorkspaceTemplateDocumentView["roles"][number],
): number {
	const order = { collection: 0, compact: 1, detail: 2 } as const;
	return (
		order[left.role] - order[right.role] ||
		(left.bindingId ?? "").localeCompare(right.bindingId ?? "")
	);
}

function templateRoleLabel(
	roles: StructuredWorkspaceTemplateDocumentView["roles"],
	t: ReturnType<typeof useT>,
): string {
	return roles
		.map((role) => {
			if (role.role === "collection") {
				return t("structured_template_role_collection");
			}
			const label =
				role.role === "compact"
					? t("structured_template_role_compact")
					: t("structured_template_role_detail");
			return `${label} · ${role.bindingId ?? ""}`;
		})
		.join(" / ");
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
			...workspace.templateDocuments.map((template) => template.documentName),
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
