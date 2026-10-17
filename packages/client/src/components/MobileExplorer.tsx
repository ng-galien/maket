import { ArrowUp, Folder, Grid2X2, List, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { browserPath } from "../lib/browserBasePath";
import {
	beginMobileNavigation,
	isRestoringMobileNavigation,
	useMobileHistoryState,
} from "../lib/mobileHistory";
import { displayWorkspaceCategoryPath } from "../lib/workspaceCategoryDisplay";
import type { DocSummary } from "../store/types";
import { useStore } from "../store/useStore";
import { MessagesPanel } from "./MessagesPanel";
import { MobileDocumentActions } from "./MobileDocumentActions";
import { MobilePhotosLibrary } from "./MobilePhotosLibrary";

interface ExplorerEntry {
	key: string;
	title: string;
	context: string;
	folder?: string;
	document?: string;
	workspace?: string;
	collection?: string;
	summary?: DocSummary;
}

/** This mobile navigation adapter uses the same catalog and open commands;
 * no document editing, multi-selection or desktop open/close toggles. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function MobileExplorer() {
	const t = useT();
	const open = useStore((s) => s.libraryOpen);
	const view = useStore((s) => s.libraryView);
	const docs = useStore((s) => s.docList);
	const workspaces = useStore((s) => s.structuredWorkspaces);
	const current = useStore((s) => s.focusedDocName);
	const documentFilter = useStore((s) => s.documentCategoryFilterRequest);
	const workspaceFilter = useStore((s) => s.structuredWorkspaceFilterRequest);
	const [category, setCategory] = useMobileHistoryState(
		"explorer:category",
		"",
		"destination",
	);
	const [workspaceId, setWorkspaceId] = useMobileHistoryState<string | null>(
		"explorer:workspace",
		null,
		"destination",
	);
	const [query, setQuery] = useMobileHistoryState(
		"explorer:query",
		"",
		"context",
	);
	const [preview, setPreview] = useMobileHistoryState(
		"explorer:preview",
		true,
		"context",
	);
	const scroll = useRef<HTMLDivElement>(null);
	const positions = useRef(new Map<string, number>());
	useEffect(() => {
		if (!isRestoringMobileNavigation()) setQuery("");
	}, [view, setQuery]);
	const workspaceMode = view === "structured-workspaces";
	const workspace = workspaces.find((w) => w.id === workspaceId);
	useEffect(() => {
		if (documentFilter) {
			setCategory(documentFilter.path ?? "");
			setQuery("");
			useStore.getState().clearDocumentCategoryFilterRequest();
		}
	}, [documentFilter]);
	useEffect(() => {
		if (workspaceFilter) {
			setWorkspaceId(workspaceFilter.workspaceId);
			setQuery("");
			useStore.getState().clearStructuredWorkspaceFilterRequest();
		}
	}, [workspaceFilter]);
	const templates = useMemo(
		() =>
			new Set(
				workspaces.flatMap((w) =>
					w.templateDocuments.map((d) => d.documentName),
				),
			),
		[workspaces],
	);
	const catalog = docs.filter((d) => !templates.has(d.name));
	const entries: ExplorerEntry[] = workspaceMode
		? workspaceEntries(workspaces, workspaceId, query, catalog)
		: documentEntries(catalog, category, query);
	const location = workspaceMode
		? (workspace?.name ?? t("structured_workspaces"))
		: displayWorkspaceCategoryPath(category, t("structured_workspaces")) ||
			t("documents");
	const positionKey = `${view}/${workspaceMode ? workspaceId : category}/${query}/${preview}`;
	useLayoutEffect(() => {
		if (open && scroll.current)
			scroll.current.scrollTop = positions.current.get(positionKey) ?? 0;
	}, [open, positionKey]);
	const navigate = (entry: ExplorerEntry) => {
		if (entry.folder !== undefined) {
			workspaceMode ? setWorkspaceId(entry.folder) : setCategory(entry.folder);
			setQuery("");
			return;
		}
		if (!entry.document) return;
		const state = useStore.getState();
		if (entry.workspace && entry.collection)
			state.setActiveStructuredCollection(entry.workspace, entry.collection);
		state.openWorkspaceDocument(
			entry.document,
			entry.workspace
				? { workspaceId: entry.workspace, collectionId: entry.collection }
				: undefined,
		);
		state.closeLastPanel();
	};
	const back = () => {
		beginMobileNavigation();
		setQuery("");
		if (workspaceMode) setWorkspaceId(null);
		else setCategory(category.split("/").slice(0, -1).join("/"));
	};
	return (
		<aside
			data-mobile-explorer
			data-library-panel
			data-library-mode={open ? "extended" : "compact"}
			data-library-view={view}
			aria-label={
				view === "exchange"
					? t("exchanges")
					: view === "photos"
						? t("photos")
						: workspaceMode
							? t("structured_workspaces")
							: t("documents")
			}
			className={`${open ? "flex" : "hidden"} absolute inset-0 z-[var(--z-bar)] min-h-0 flex-col bg-panel`}
		>
			<div
				className={
					view === "photos" || view === "exchange" ? "hidden" : "contents"
				}
			>
				<div className="flex min-h-16 shrink-0 items-center gap-2 border-b border-border px-3">
					{(workspaceMode ? workspaceId : category) && (
						<button
							type="button"
							onClick={back}
							aria-label={t("mobile_explorer_up")}
							className="grid size-12 shrink-0 place-items-center rounded-xl bg-input"
						>
							<ArrowUp size={22} />
						</button>
					)}
					<div className="min-w-0 flex-1">
						<h1
							className="break-words text-[16px] font-semibold leading-snug"
							title={location}
						>
							{location}
						</h1>
					</div>
					<button
						type="button"
						aria-label={t(preview ? "view_list" : "view_grid")}
						onClick={() => setPreview(!preview)}
						className="grid size-12 shrink-0 place-items-center rounded-xl border border-border"
					>
						{preview ? <List size={22} /> : <Grid2X2 size={22} />}
					</button>
					<button
						type="button"
						aria-label={t("close_active_panel")}
						onClick={() => useStore.getState().closeLastPanel()}
						className="grid size-12 shrink-0 place-items-center"
					>
						<X size={22} />
					</button>
				</div>
				<div
					ref={scroll}
					data-mobile-explorer-scroll
					onScroll={() => {
						if (scroll.current)
							positions.current.set(positionKey, scroll.current.scrollTop);
					}}
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
				>
					<div className="flex flex-col gap-3">
						{entries.map((entry) => (
							<MobileExplorerEntry
								key={entry.key}
								entry={entry}
								preview={preview}
								current={current}
								onOpen={() => navigate(entry)}
							/>
						))}
						{!entries.length && (
							<p role="status" className="px-3 py-8 text-[16px] text-text-3">
								{t("no_document")}
							</p>
						)}
					</div>
				</div>
				<ExplorerSearch query={query} onChange={setQuery} />
			</div>
			<MobilePhotosLibrary active={open && view === "photos"} />
			{view === "exchange" && <MessagesPanel />}
		</aside>
	);
}

function MobileExplorerPreview({ entry }: { entry: ExplorerEntry }) {
	const [failed, setFailed] = useState(false);
	if (failed) return null;
	const token = entry.summary?.updatedAt ?? entry.summary?.id ?? entry.document;
	const src = browserPath(
		`/api/thumb?name=${encodeURIComponent(entry.document ?? "")}&page=1&w=640&t=${encodeURIComponent(token ?? "")}`,
	);
	return (
		<span className="block h-44 overflow-hidden border-b border-border bg-white">
			<img
				data-mobile-explorer-preview
				src={src}
				alt=""
				loading="lazy"
				onError={() => setFailed(true)}
				className="h-full w-full object-cover object-top"
				draggable={false}
			/>
		</span>
	);
}

function documentEntries(
	docs: DocSummary[],
	category: string,
	query: string,
): ExplorerEntry[] {
	const search = query.trim().toLocaleLowerCase();
	if (search)
		return docs
			.filter((d) =>
				`${d.name} ${d.category}`.toLocaleLowerCase().includes(search),
			)
			.map((d) => ({
				key: d.id,
				title: d.name,
				context: d.category,
				document: d.name,
				summary: d,
			}));
	const prefix = category ? `${category}/` : "";
	const folders = new Map<string, number>();
	const leaves: ExplorerEntry[] = [];
	for (const doc of docs) {
		const path = doc.category ?? "";
		if (path === category) {
			leaves.push({
				key: doc.id,
				title: doc.name,
				context: path,
				document: doc.name,
				summary: doc,
			});
			continue;
		}
		if (!path.startsWith(prefix)) continue;
		const name = path.slice(prefix.length).split("/")[0];
		if (name) folders.set(name, (folders.get(name) ?? 0) + 1);
	}
	return [
		...[...folders]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name]) => ({
				key: `folder:${prefix}${name}`,
				title: name,
				context: "",
				folder: `${prefix}${name}`,
			})),
		...leaves,
	];
}

function workspaceEntries(
	workspaces: ReturnType<typeof useStore.getState>["structuredWorkspaces"],
	workspaceId: string | null,
	query: string,
	docs: DocSummary[],
): ExplorerEntry[] {
	const search = query.trim().toLocaleLowerCase();
	if (!workspaceId && !search)
		return workspaces.map((w) => ({
			key: w.id,
			title: w.name,
			context: "",
			folder: w.id,
		}));
	return workspaces
		.filter((w) => search || w.id === workspaceId)
		.flatMap((w) =>
			Object.entries(w.representationSchema.collections).flatMap(
				([id, collection]) => {
					if (
						search &&
						!`${w.name} ${collection.name}`.toLocaleLowerCase().includes(search)
					)
						return [];
					const index = w.collectionDocuments.find(
						(d) => d.collectionId === id,
					);
					return index
						? [
								{
									key: `${w.id}/${id}`,
									title: collection.name,
									context: w.name,
									document: index.documentName,
									workspace: w.id,
									collection: id,
									summary: docs.find((d) => d.name === index.documentName),
								},
							]
						: [];
				},
			),
		);
}

function MobileExplorerEntry({
	entry,
	preview,
	current,
	onOpen,
}: {
	entry: ExplorerEntry;
	preview: boolean;
	current: string | null;
	onOpen: () => void;
}) {
	const t = useT();
	return (
		<div
			data-mobile-explorer-entry
			data-current={entry.document === current || undefined}
			className={`relative overflow-hidden rounded-xl border ${entry.document === current ? "border-accent bg-accent-soft" : "border-border bg-panel"}`}
		>
			<button
				type="button"
				onClick={onOpen}
				aria-label={entry.title}
				className="block w-full text-left transition-colors hover:bg-input"
			>
				{preview && entry.document && <MobileExplorerPreview entry={entry} />}
				<span
					className={`flex min-h-16 items-center gap-3 px-4 py-3 ${entry.document ? "pr-16" : ""}`}
				>
					{entry.folder !== undefined && (
						<Folder size={24} className="shrink-0 text-accent" />
					)}
					<span className="min-w-0 flex-1">
						<span className="block break-words text-[16px] font-semibold leading-snug">
							{entry.title}
						</span>
						{entry.document === current && (
							<span className="mt-1 block text-[14px] text-accent">
								{t("mobile_current_document")}
							</span>
						)}
					</span>
				</span>
			</button>
			{entry.document && entry.summary && (
				<MobileDocumentActions
					doc={entry.summary}
					workspaceId={entry.workspace}
					collectionId={entry.collection}
				/>
			)}
		</div>
	);
}

function ExplorerSearch({
	query,
	onChange,
}: {
	query: string;
	onChange: (value: string) => void;
}) {
	const t = useT();
	return (
		<div
			className="shrink-0 border-t border-border bg-panel p-3"
			data-mobile-explorer-search
		>
			<label className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-input px-3">
				<Search size={22} className="shrink-0 text-text-3" />
				<input
					type="search"
					aria-label={t("mobile_explorer_search")}
					placeholder={t("mobile_explorer_search")}
					value={query}
					onChange={(e) => onChange(e.target.value)}
					className="min-w-0 flex-1 bg-transparent py-3 text-[16px] text-text-1 outline-none"
				/>
				{query && (
					<button
						type="button"
						aria-label={t("clear_search")}
						onClick={() => onChange("")}
						className="grid size-12 shrink-0 place-items-center"
					>
						<X size={20} />
					</button>
				)}
			</label>
		</div>
	);
}
