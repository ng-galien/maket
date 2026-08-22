import { normalizeCategoryPath } from "@maket/shared";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore, useWorkspaceDocNames } from "../store/useStore";
import { wsSend } from "../store/ws";
import { BulkActionBar } from "./docs/BulkActionBar";
import { CategoryPicker } from "./docs/CategoryPicker";
import {
	buildCategoryTree,
	categoryPathsForDocs,
	visibleDocOrder,
} from "./docs/categoryTree";
import { createDocItemProps } from "./docs/DocItem";
import { buildCategoryModels, DocsCategory } from "./docs/DocsCategory";
import { createToolbarModel, DocsToolbar } from "./docs/DocsToolbar";
import { importMaketBundle } from "./docs/docsImportExport";
import { addCategoryFilter, matchesQuery, parseQuery } from "./docs/docsQuery";
import { createBulkActions, handleDocSelection } from "./docs/docsSelection";
import type {
	CategoryMoveTarget,
	DocsTabModel,
	RowMode,
	View,
} from "./docs/types";
import { COLLAPSED_KEY, VIEW_KEY } from "./docs/types";
import { LibraryToolbar } from "./shared/LibraryToolbar";

function loadCollapsed(): Set<string> {
	try {
		const raw = localStorage.getItem(COLLAPSED_KEY);
		if (!raw) return new Set();
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
	} catch {
		return new Set();
	}
}

function saveCollapsed(set: Set<string>): void {
	try {
		localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
	} catch {}
}

export function DocsTab() {
	const model = useDocsTabModel();
	return <DocsTabView model={model} />;
}

// code-moniker: ignore[smell-feature-envy-local]
// Docs tab shell adapter: useDocsTabModel's job is to wire store, WS load,
// selection, and pure factories (toolbar/category/item). Cross-owner calls
// are composition, not logic that should move into documents or the store.
function useDocsTabModel(): DocsTabModel {
	const t = useT();
	const docList = useStore((state) => state.docList);
	const workspaceDocNames = useWorkspaceDocNames();
	const focusedDocName = useStore((state) => state.focusedDocName);
	const closeWorkspaceDocuments = useStore(
		(state) => state.closeWorkspaceDocuments,
	);
	const openWorkspaceDocument = useStore(
		(state) => state.openWorkspaceDocument,
	);
	const [search, setSearch] = useState("");
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [categoryMenuFor, setCategoryMenuFor] = useState<string | null>(null);
	const [categoryRenameFor, setCategoryRenameFor] = useState<string | null>(
		null,
	);
	const [modeFor, setModeFor] = useState<{
		name: string;
		mode: RowMode;
	} | null>(null);
	const [collapsed, setCollapsed] = useState<Set<string>>(() =>
		loadCollapsed(),
	);
	const [dragOverCat, setDragOverCat] = useState<string | null>(null);
	const [draggingName, setDraggingName] = useState<string | null>(null);
	const [view, setView] = usePersistedDocsView();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [lastClicked, setLastClicked] = useState<string | null>(null);
	const categoryFilterRequest = useStore(
		(state) => state.documentCategoryFilterRequest,
	);
	const clearCategoryFilterRequest = useStore(
		(state) => state.clearDocumentCategoryFilterRequest,
	);
	const importState = useMaketImport(t);
	useClearSelectionOnEscape(selected.size, () => setSelected(new Set()));
	useApplyDocumentCategoryFilter({
		request: categoryFilterRequest,
		clearRequest: clearCategoryFilterRequest,
		setSearch,
	});

	const searching = search.trim().length > 0;
	const query = parseQuery(search, { deferLastFilterToken: true });
	const filtered = docList.filter((doc) => matchesQuery(doc, query));
	const categoryTree = buildCategoryTree(filtered);
	const categoryPaths = categoryPathsForDocs(docList);
	const categoryMove = useCategoryMovePicker(categoryPaths);
	const openDocNames = new Set(workspaceDocNames);
	const flatOrder = visibleDocOrder(categoryTree, searching, collapsed);
	const clearSelection = () => setSelected(new Set());
	const isOnWorkspace = (name: string) => workspaceDocNames.includes(name);
	const openDoc = (name: string) => {
		if (isOnWorkspace(name)) closeWorkspaceDocuments([name]);
		else openWorkspaceDocument(name);
	};
	const focusDoc = openWorkspaceDocument;

	const selection = {
		selected,
		setSelected,
		lastClicked,
		setLastClicked,
		flatOrder,
		openDoc,
		clearSelection,
	};
	const rowClick = (name: string, event: React.MouseEvent) =>
		handleDocSelection(name, event, selection);

	const bulkActions = createBulkActions(docList, selected, clearSelection);
	return {
		toolbar: createToolbarModel({
			search,
			setSearch,
			categories: categoryPaths,
			query,
			view,
			setView,
			importState,
		}),
		categories: buildCategoryModels({
			nodes: categoryTree,
			searching,
			collapsed,
			toggleCategory: (cat) => toggleCollapsedCategory(cat, setCollapsed),
			dragOverCat,
			setDragOverCat,
			setDraggingName,
			categoryMenuFor,
			setCategoryMenuFor,
			categoryRenameFor,
			setCategoryRenameFor,
			requestCategoryMove: categoryMove.requestCategoryMove,
			renameCategory: moveCategoryLeaf,
			docList,
			openDocNames,
			view,
			itemFor: (doc) =>
				createDocItemProps({
					doc,
					docList,
					selected,
					menuFor,
					modeFor,
					draggingName,
					isOnWorkspace,
					isFocused: (name) => focusedDocName === name,
					focusDoc,
					setMenuFor,
					setModeFor,
					setDraggingName,
					setDragOverCat,
					rowClick,
					requestMoveCategory: categoryMove.requestDocumentMove,
				}),
		}),
		empty: filtered.length === 0,
		selected,
		bulk: {
			model: { selected, docList },
			actions: bulkActions,
		},
		movePicker: categoryMove.model,
	};
}

function useCategoryMovePicker(categories: string[]) {
	const [target, setTarget] = useState<CategoryMoveTarget | null>(null);
	return {
		model: {
			target,
			categories,
			close: () => setTarget(null),
			moveTo: (path: string) => {
				if (!target) return;
				if (target.kind === "document") {
					const category = normalizeCategoryPath(path);
					if (category !== normalizeCategoryPath(target.category)) {
						wsSend({
							type: "update_meta",
							docName: target.name,
							category,
						});
					}
				} else {
					moveCategoryUnder(target.path, path);
				}
				setTarget(null);
			},
		},
		requestDocumentMove: (document: { name: string; category: string }) =>
			setTarget({
				kind: "document",
				name: document.name,
				category: document.category,
			}),
		requestCategoryMove: (path: string) =>
			setTarget({ kind: "category", path }),
	};
}

function moveCategoryLeaf(source: string, nextName: string) {
	const normalizedName = normalizeCategoryPath(nextName);
	const leaf = normalizedName.split("/").at(-1);
	if (!leaf) return;
	const parent = source.split("/").slice(0, -1).join("/");
	const destination = parent ? `${parent}/${leaf}` : leaf;
	moveCategory(source, destination);
}

function moveCategoryUnder(source: string, parent: string) {
	const leaf = source.split("/").at(-1);
	if (!leaf) return;
	const normalizedParent = parent ? normalizeCategoryPath(parent) : "";
	const destination = normalizedParent ? `${normalizedParent}/${leaf}` : leaf;
	moveCategory(source, destination);
}

function moveCategory(source: string, destination: string) {
	if (destination === source) return;
	wsSend({ type: "move_category", source, destination });
}

function useApplyDocumentCategoryFilter({
	request,
	clearRequest,
	setSearch,
}: {
	request: { path: string } | null;
	clearRequest: () => void;
	setSearch: React.Dispatch<React.SetStateAction<string>>;
}) {
	useEffect(() => {
		if (!request) return;
		setSearch((current) => addCategoryFilter(current, request.path));
		clearRequest();
	}, [clearRequest, request, setSearch]);
}

function usePersistedDocsView() {
	const [view, setView] = useState<View>(() => {
		const stored = localStorage.getItem(VIEW_KEY);
		return stored === "grid" ? "grid" : "list";
	});
	const setViewAndPersist = (next: View) => {
		setView(next);
		try {
			localStorage.setItem(VIEW_KEY, next);
		} catch {}
	};
	return [view, setViewAndPersist] as const;
}

function useClearSelectionOnEscape(size: number, clear: () => void) {
	useEffect(() => {
		if (size === 0) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") clear();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [clear, size]);
}

function useMaketImport(t: ReturnType<typeof useT>) {
	const importInputRef = useRef<HTMLInputElement>(null);
	const [importError, setImportError] = useState<string | null>(null);
	const [importDrag, setImportDrag] = useState(false);

	const handleImportFile = async (file: File) => {
		setImportError(null);
		const res = await importMaketBundle(file);
		if (!res.ok) {
			setImportError(t("import_maket_error", { message: res.message }));
		}
	};

	return {
		importInputRef,
		importError,
		importDrag,
		setImportError,
		setImportDrag,
		handleImportFile,
	};
}

function toggleCollapsedCategory(
	cat: string,
	setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
	setCollapsed((prev) => {
		const next = new Set(prev);
		if (next.has(cat)) next.delete(cat);
		else next.add(cat);
		saveCollapsed(next);
		return next;
	});
}

function DocsTabView({ model }: { model: DocsTabModel }) {
	const t = useT();
	return (
		<div className="h-full min-h-0 flex flex-col overflow-hidden">
			<CategoryPicker model={model.movePicker} />
			<LibraryToolbar>
				<DocsToolbar model={model.toolbar} />
			</LibraryToolbar>
			<div
				data-documents-scroll
				className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto p-2.5"
			>
				{model.categories.map((category) => (
					<DocsCategory key={category.path} model={category} />
				))}
				{model.empty && (
					<div className="px-4 py-6 text-center text-base text-text-3">
						{t("no_document")}
					</div>
				)}
			</div>
			{model.selected.size > 0 && (
				<div className="shrink-0 px-2">
					<BulkActionBar {...model.bulk} />
				</div>
			)}
		</div>
	);
}
