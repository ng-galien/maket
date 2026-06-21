import { computeCanvasDims, DEFAULT_ORIENTATION } from "@maket/shared";
import {
	ChevronRight,
	Copy,
	Download,
	Files,
	FileText,
	LayoutGrid,
	List,
	Lock,
	MoreVertical,
	Pencil,
	Trash2,
	Unlock,
	Upload,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import type { DocSummary } from "../store/types";
import { useStore, useWorkspaceDocNames } from "../store/useStore";
import {
	sendDeleteDoc,
	sendDuplicateDoc,
	sendLoadDoc,
	sendLockDoc,
	sendRenameDoc,
	wsSend,
} from "../store/ws";
import { copyToClipboard } from "../utils";
import { DraftPill } from "./shared/DraftPill";
import { HoldToDelete } from "./shared/HoldToDelete";

const DRAG_MIME = "application/x-maket-doc";
const VIEW_KEY = "maket-docs-view";
type View = "list" | "grid";

function docAspectRatio(doc: DocSummary): number {
	const { w, h } = computeCanvasDims(
		doc.format,
		doc.orientation ?? DEFAULT_ORIENTATION,
	);
	return h / w;
}

// Category color by hash
function catColor(cat: string): string {
	const COLORS = [
		"#60a5fa",
		"#a78bfa",
		"#f59e0b",
		"#10b981",
		"#f472b6",
		"#34d399",
		"#fb923c",
	];
	let h = 0;
	for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) | 0;
	return COLORS[Math.abs(h) % COLORS.length];
}

function exportMaketBundle(names: string[]): void {
	const qs =
		names.length === 1
			? `name=${encodeURIComponent(names[0] ?? "")}`
			: `names=${encodeURIComponent(names.join(","))}`;
	const a = document.createElement("a");
	a.href = `/api/export-maket?${qs}`;
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
}

async function importMaketBundle(file: File): Promise<{
	ok: boolean;
	message: string;
	count: number;
}> {
	try {
		const res = await fetch("/api/import-maket", {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: file,
		});
		const json = (await res.json()) as {
			error?: string;
			documents?: string[];
		};
		if (!res.ok)
			return {
				ok: false,
				message: json.error || `HTTP ${res.status}`,
				count: 0,
			};
		return { ok: true, message: "", count: json.documents?.length ?? 0 };
	} catch (e) {
		return { ok: false, message: (e as Error).message, count: 0 };
	}
}

type RowMode =
	| { kind: "idle" }
	| { kind: "rename" }
	| { kind: "duplicate" }
	| { kind: "confirm-delete" };

const COLLAPSED_KEY = "maket-categories-collapsed";

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

/**
 * Multi-criteria search parser.
 *   @cat       — restrict to category `cat`
 *   #locked    — only locked docs
 *   #unlocked  — only unlocked docs
 *   :N         — rating ≥ N (1–5)
 *   <rest>     — fuzzy substring on name
 * Tokens accumulate (AND), so `@flyer #locked :4 summer` means
 * "flyer AND locked AND rating≥4 AND name contains summer".
 */
interface Query {
	category: string | null;
	locked: boolean | null;
	minRating: number;
	text: string;
}

interface QueryChip {
	key: string;
	label: string;
	onRemove: () => void;
}

function parseQuery(raw: string): Query {
	const tokens = raw.split(/\s+/).filter(Boolean);
	let category: string | null = null;
	let locked: boolean | null = null;
	let minRating = 0;
	const text: string[] = [];
	for (const tok of tokens) {
		if (tok.startsWith("@") && tok.length > 1) {
			category = tok.slice(1).toLowerCase();
		} else if (tok === "#locked") {
			locked = true;
		} else if (tok === "#unlocked") {
			locked = false;
		} else if (/^:\d$/.test(tok)) {
			minRating = Math.max(minRating, Number(tok.slice(1)));
		} else {
			text.push(tok);
		}
	}
	return { category, locked, minRating, text: text.join(" ").toLowerCase() };
}

function matchesQuery(d: DocSummary, q: Query): boolean {
	if (q.category && (d.category || "general").toLowerCase() !== q.category)
		return false;
	if (q.locked !== null && (d.locked === true) !== q.locked) return false;
	if (q.minRating > 0 && (d.rating ?? 0) < q.minRating) return false;
	if (q.text && !d.name.toLowerCase().includes(q.text)) return false;
	return true;
}

function stripToken(raw: string, predicate: (tok: string) => boolean): string {
	return raw
		.split(/\s+/)
		.filter(Boolean)
		.filter((tok) => !predicate(tok))
		.join(" ");
}

/**
 * SQLite emits timestamps as "YYYY-MM-DD HH:mm:ss" in UTC. Convert to a
 * Date; fall back to a best-effort ISO replacement.
 */
function parseTimestamp(ts: string | undefined): Date | null {
	if (!ts) return null;
	const iso = ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(ts: string | undefined, lang: string): string {
	const d = parseTimestamp(ts);
	if (!d) return "";
	const diffMs = Date.now() - d.getTime();
	const m = Math.round(diffMs / 60000);
	const fr = lang.startsWith("fr");
	if (m < 1) return fr ? "à l'instant" : "just now";
	if (m < 60) return fr ? `il y a ${m} min` : `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return fr ? `il y a ${h} h` : `${h}h ago`;
	const days = Math.round(h / 24);
	if (days < 30) return fr ? `il y a ${days} j` : `${days}d ago`;
	const months = Math.round(days / 30);
	if (months < 12) return fr ? `il y a ${months} mois` : `${months}mo ago`;
	const years = Math.round(months / 12);
	return fr ? `il y a ${years} an${years > 1 ? "s" : ""}` : `${years}y ago`;
}

export function DocsTab() {
	const model = useDocsTabModel();
	return <DocsTabView model={model} />;
}

interface DocsTabModel {
	barPosition: "bottom" | "top";
	toolbar: DocsToolbarModel;
	categories: DocsCategoryModel[];
	empty: boolean;
	selected: Set<string>;
	bulk: BulkActionBarProps;
}

interface DocsToolbarModel {
	search: string;
	setSearch: (value: string) => void;
	chips: QueryChip[];
	importInputRef: React.RefObject<HTMLInputElement | null>;
	importError: string | null;
	importDrag: boolean;
	clearImportError: () => void;
	startImport: () => void;
	handleImportInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
	handleImportDragOver: (event: React.DragEvent) => void;
	handleImportDragLeave: () => void;
	handleImportDrop: (event: React.DragEvent) => void;
	view: View;
	setView: (view: View) => void;
}

interface DocsCategoryModel {
	name: string;
	docs: DocSummary[];
	collapsed: boolean;
	dropActive: boolean;
	view: View;
	toggle: () => void;
	dragOver: (event: React.DragEvent) => void;
	dragLeave: (event: React.DragEvent) => void;
	drop: (event: React.DragEvent) => void;
	itemFor: (doc: DocSummary) => DocItemProps;
}

function useDocsTabModel(): DocsTabModel {
	const t = useT();
	const docList = useStore((state) => state.docList);
	const workspaceDocNames = useWorkspaceDocNames();
	const barPosition = useStore((state) => state.barPosition);
	const removeDoc = useStore((state) => state.removeDocFromWorkspace);
	const [search, setSearch] = useState("");
	const [menuFor, setMenuFor] = useState<string | null>(null);
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
	const importState = useMaketImport(t);
	useClearSelectionOnEscape(selected.size, () => setSelected(new Set()));

	const searching = search.trim().length > 0;
	const query = parseQuery(search);
	const filtered = docList.filter((doc) => matchesQuery(doc, query));
	const grouped = groupDocs(filtered);
	const flatOrder = visibleDocOrder(grouped, searching, collapsed);
	const clearSelection = () => setSelected(new Set());
	const isOnWorkspace = (name: string) => workspaceDocNames.includes(name);
	const openDoc = (name: string) =>
		isOnWorkspace(name) ? removeDoc(name) : sendLoadDoc(name);

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
		barPosition,
		toolbar: createToolbarModel({
			search,
			setSearch,
			query,
			view,
			setView,
			importState,
		}),
		categories: buildCategoryModels({
			grouped,
			searching,
			collapsed,
			toggleCategory: (cat) => toggleCollapsedCategory(cat, setCollapsed),
			dragOverCat,
			setDragOverCat,
			setDraggingName,
			docList,
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
					setMenuFor,
					setModeFor,
					setDraggingName,
					setDragOverCat,
					rowClick,
				}),
		}),
		empty: filtered.length === 0,
		selected,
		bulk: {
			model: { selected, docList },
			actions: bulkActions,
		},
	};
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

function groupDocs(docs: DocSummary[]): Map<string, DocSummary[]> {
	const grouped = new Map<string, DocSummary[]>();
	for (const doc of docs) {
		const cat = doc.category || "general";
		if (!grouped.has(cat)) grouped.set(cat, []);
		grouped.get(cat)?.push(doc);
	}
	return grouped;
}

function visibleDocOrder(
	grouped: Map<string, DocSummary[]>,
	searching: boolean,
	collapsed: Set<string>,
): string[] {
	return [...grouped.entries()]
		.filter(([cat]) => searching || !collapsed.has(cat))
		.flatMap(([, docs]) => docs.map((doc) => doc.name));
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

interface SelectionContext {
	selected: Set<string>;
	setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
	lastClicked: string | null;
	setLastClicked: (name: string) => void;
	flatOrder: string[];
	openDoc: (name: string) => void;
	clearSelection: () => void;
}

function handleDocSelection(
	name: string,
	event: React.MouseEvent,
	context: SelectionContext,
) {
	if (event.metaKey || event.ctrlKey) {
		event.preventDefault();
		toggleSelectedName(name, context);
		return;
	}
	if (event.shiftKey && context.lastClicked) {
		event.preventDefault();
		selectRange(name, context);
		return;
	}
	if (context.selected.size > 0) context.clearSelection();
	context.setLastClicked(name);
	context.openDoc(name);
}

function toggleSelectedName(name: string, context: SelectionContext) {
	context.setSelected((prev) => {
		const next = new Set(prev);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		return next;
	});
	context.setLastClicked(name);
}

function selectRange(name: string, context: SelectionContext) {
	const from = context.flatOrder.indexOf(context.lastClicked ?? "");
	const to = context.flatOrder.indexOf(name);
	if (from < 0 || to < 0) return;
	const [lo, hi] = from < to ? [from, to] : [to, from];
	context.setSelected((prev) => {
		const next = new Set(prev);
		for (let index = lo; index <= hi; index++) {
			const selectedName = context.flatOrder[index];
			if (selectedName) next.add(selectedName);
		}
		return next;
	});
}

function createBulkActions(
	docList: DocSummary[],
	selected: Set<string>,
	clearSelection: () => void,
): BulkActionBarActions {
	return {
		clear: clearSelection,
		lock: () => applyBulkLock(docList, selected, true, clearSelection),
		unlock: () => applyBulkLock(docList, selected, false, clearSelection),
		recategorize: (cat) =>
			applyBulkCategory(docList, selected, cat, clearSelection),
		delete: () => applyBulkDelete(docList, selected, clearSelection),
		export: () => {
			exportMaketBundle([...selected]);
			clearSelection();
		},
	};
}

function applyBulkLock(
	docList: DocSummary[],
	selected: Set<string>,
	locked: boolean,
	clearSelection: () => void,
) {
	for (const name of selected) {
		const doc = docList.find((item) => item.name === name);
		if (doc && (doc.locked === true) !== locked) sendLockDoc(name, locked);
	}
	clearSelection();
}

function applyBulkCategory(
	docList: DocSummary[],
	selected: Set<string>,
	cat: string,
	clearSelection: () => void,
) {
	const trimmed = cat.trim();
	if (!trimmed) return;
	for (const name of selected) {
		const doc = docList.find((item) => item.name === name);
		if (!doc || doc.category === trimmed || doc.locked === true) continue;
		wsSend({ type: "update_meta", docName: name, category: trimmed });
	}
	clearSelection();
}

function applyBulkDelete(
	docList: DocSummary[],
	selected: Set<string>,
	clearSelection: () => void,
) {
	if (docList.length - selected.size < 1) return;
	for (const name of selected) {
		const doc = docList.find((item) => item.name === name);
		if (doc && doc.locked !== true) sendDeleteDoc(name);
	}
	clearSelection();
}

interface ToolbarFactoryArgs {
	search: string;
	setSearch: (value: string) => void;
	query: Query;
	view: View;
	setView: (view: View) => void;
	importState: ReturnType<typeof useMaketImport>;
}

function createToolbarModel(args: ToolbarFactoryArgs): DocsToolbarModel {
	const { importState } = args;
	return {
		search: args.search,
		setSearch: args.setSearch,
		chips: buildQueryChips(args.query, args.search, args.setSearch),
		importInputRef: importState.importInputRef,
		importError: importState.importError,
		importDrag: importState.importDrag,
		clearImportError: () => importState.setImportError(null),
		startImport: () => importState.importInputRef.current?.click(),
		handleImportInput: (event) => {
			const file = event.target.files?.[0];
			if (file) void importState.handleImportFile(file);
			event.target.value = "";
		},
		handleImportDragOver: (event) => {
			if (!event.dataTransfer.types.includes("Files")) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			if (!importState.importDrag) importState.setImportDrag(true);
		},
		handleImportDragLeave: () => importState.setImportDrag(false),
		handleImportDrop: (event) => handleImportDrop(event, importState),
		view: args.view,
		setView: args.setView,
	};
}

function handleImportDrop(
	event: React.DragEvent,
	importState: ReturnType<typeof useMaketImport>,
) {
	event.preventDefault();
	importState.setImportDrag(false);
	const file = Array.from(event.dataTransfer.files).find((item) =>
		item.name.toLowerCase().endsWith(".maket"),
	);
	if (file) void importState.handleImportFile(file);
	else importState.setImportError("Import failed: .maket");
}

function buildQueryChips(
	query: Query,
	search: string,
	setSearch: (value: string) => void,
): QueryChip[] {
	const chips: QueryChip[] = [];
	if (query.category) {
		chips.push({
			key: "cat",
			label: `@${query.category}`,
			onRemove: () =>
				setSearch(
					stripToken(
						search,
						(token) => token.toLowerCase() === `@${query.category}`,
					),
				),
		});
	}
	if (query.locked !== null) {
		const token = query.locked ? "#locked" : "#unlocked";
		chips.push({
			key: "lock",
			label: token,
			onRemove: () => setSearch(stripToken(search, (item) => item === token)),
		});
	}
	if (query.minRating > 0) {
		chips.push({
			key: "rating",
			label: `≥ ${"★".repeat(query.minRating)}`,
			onRemove: () =>
				setSearch(stripToken(search, (token) => /^:\d$/.test(token))),
		});
	}
	return chips;
}

interface CategoryFactoryArgs {
	grouped: Map<string, DocSummary[]>;
	searching: boolean;
	collapsed: Set<string>;
	toggleCategory: (cat: string) => void;
	dragOverCat: string | null;
	setDragOverCat: React.Dispatch<React.SetStateAction<string | null>>;
	setDraggingName: React.Dispatch<React.SetStateAction<string | null>>;
	docList: DocSummary[];
	view: View;
	itemFor: (doc: DocSummary) => DocItemProps;
}

function buildCategoryModels(args: CategoryFactoryArgs): DocsCategoryModel[] {
	return [...args.grouped.entries()].map(([cat, docs]) => ({
		name: cat,
		docs,
		collapsed: !args.searching && args.collapsed.has(cat),
		dropActive: args.dragOverCat === cat,
		view: args.view,
		toggle: () => args.toggleCategory(cat),
		dragOver: (event) => handleCategoryDragOver(event, cat, args),
		dragLeave: (event) => handleCategoryDragLeave(event, cat, args),
		drop: (event) => handleCategoryDrop(event, cat, args),
		itemFor: args.itemFor,
	}));
}

function handleCategoryDragOver(
	event: React.DragEvent,
	cat: string,
	args: CategoryFactoryArgs,
) {
	if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
	event.preventDefault();
	event.dataTransfer.dropEffect = "move";
	if (args.dragOverCat !== cat) args.setDragOverCat(cat);
}

function handleCategoryDragLeave(
	event: React.DragEvent,
	cat: string,
	args: CategoryFactoryArgs,
) {
	const related = event.relatedTarget as Node | null;
	if (!related || !event.currentTarget.contains(related)) {
		args.setDragOverCat((current) => (current === cat ? null : current));
	}
}

function handleCategoryDrop(
	event: React.DragEvent,
	cat: string,
	args: CategoryFactoryArgs,
) {
	const name = event.dataTransfer.getData(DRAG_MIME);
	args.setDragOverCat(null);
	args.setDraggingName(null);
	if (!name) return;
	const src = args.docList.find((doc) => doc.name === name);
	if (!src || src.category === cat) return;
	wsSend({ type: "update_meta", docName: name, category: cat });
}

interface DocItemFactoryArgs {
	doc: DocSummary;
	docList: DocSummary[];
	selected: Set<string>;
	menuFor: string | null;
	modeFor: { name: string; mode: RowMode } | null;
	draggingName: string | null;
	isOnWorkspace: (name: string) => boolean;
	setMenuFor: React.Dispatch<React.SetStateAction<string | null>>;
	setModeFor: React.Dispatch<
		React.SetStateAction<{ name: string; mode: RowMode } | null>
	>;
	setDraggingName: React.Dispatch<React.SetStateAction<string | null>>;
	setDragOverCat: React.Dispatch<React.SetStateAction<string | null>>;
	rowClick: (name: string, event: React.MouseEvent) => void;
}

function createDocItemProps(args: DocItemFactoryArgs): DocItemProps {
	const { doc } = args;
	return {
		model: {
			doc,
			onWs: args.isOnWorkspace(doc.name),
			selected: args.selected.has(doc.name),
			menuOpen: args.menuFor === doc.name,
			mode:
				args.modeFor?.name === doc.name
					? args.modeFor.mode
					: ({ kind: "idle" } as RowMode),
			canDelete: args.docList.length > 1,
			dragging: args.draggingName === doc.name,
		},
		actions: {
			click: (event) => args.rowClick(doc.name, event),
			openMenu: () => args.setMenuFor(doc.name),
			closeMenu: () => args.setMenuFor(null),
			changeMode: (mode) =>
				args.setModeFor(mode.kind === "idle" ? null : { name: doc.name, mode }),
			dragStart: (event) => {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData(DRAG_MIME, doc.name);
				args.setDraggingName(doc.name);
			},
			dragEnd: () => {
				args.setDraggingName(null);
				args.setDragOverCat(null);
			},
		},
	};
}

function DocsTabView({ model }: { model: DocsTabModel }) {
	const t = useT();
	return (
		<div
			className={`flex ${
				model.barPosition === "bottom" ? "flex-col-reverse" : "flex-col"
			} gap-2 p-3`}
		>
			<DocsToolbar model={model.toolbar} />
			{model.categories.map((category) => (
				<DocsCategory key={category.name} model={category} />
			))}
			{model.empty && (
				<div className="px-4 py-6 text-center text-base text-text-3">
					{t("no_document")}
				</div>
			)}
			{model.selected.size > 0 && <BulkActionBar {...model.bulk} />}
		</div>
	);
}

function DocsToolbar({ model }: { model: DocsToolbarModel }) {
	const t = useT();
	return (
		<div className="px-1 flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5">
				<input
					value={model.search}
					onChange={(event) => model.setSearch(event.target.value)}
					placeholder={t("search_hint")}
					className="flex-1 min-w-0 px-3 py-2 bg-input rounded-lg text-base outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
				/>
				<input
					ref={model.importInputRef}
					type="file"
					accept=".maket"
					className="hidden"
					onChange={model.handleImportInput}
				/>
				<ImportButton model={model} />
				<ViewToggle view={model.view} setView={model.setView} />
			</div>
			{model.importError && (
				<button
					type="button"
					onClick={model.clearImportError}
					className="text-left text-2xs text-danger bg-danger-soft rounded-md px-2 py-1"
				>
					{model.importError} ×
				</button>
			)}
			<QueryChips chips={model.chips} />
		</div>
	);
}

function ImportButton({ model }: { model: DocsToolbarModel }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={model.startImport}
			onDragOver={model.handleImportDragOver}
			onDragLeave={model.handleImportDragLeave}
			onDrop={model.handleImportDrop}
			aria-label={t("import_maket")}
			title={t("import_maket")}
			className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
				model.importDrag
					? "bg-accent-soft text-accent ring-2 ring-accent/40"
					: "bg-input text-text-3 hover:text-text-1"
			}`}
		>
			<Upload size={14} />
		</button>
	);
}

function ViewToggle({
	view,
	setView,
}: {
	view: View;
	setView: (view: View) => void;
}) {
	const t = useT();
	return (
		<div className="flex rounded-lg bg-input p-0.5">
			<ViewToggleButton
				active={view === "list"}
				label={t("view_list")}
				onClick={() => setView("list")}
				icon={<List size={14} />}
			/>
			<ViewToggleButton
				active={view === "grid"}
				label={t("view_grid")}
				onClick={() => setView("grid")}
				icon={<LayoutGrid size={14} />}
			/>
		</div>
	);
}

function ViewToggleButton({
	active,
	label,
	onClick,
	icon,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	icon: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={`w-8 h-8 rounded-md flex items-center justify-center transition ${
				active
					? "bg-panel shadow-sm text-text-1"
					: "text-text-3 hover:text-text-1"
			}`}
		>
			{icon}
		</button>
	);
}

function QueryChips({ chips }: { chips: QueryChip[] }) {
	if (chips.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1 px-1">
			{chips.map((chip) => (
				<button
					key={chip.key}
					type="button"
					onClick={chip.onRemove}
					className="group flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-2xs font-semibold hover:bg-accent/15 transition"
				>
					<span>{chip.label}</span>
					<span
						aria-hidden
						className="opacity-60 group-hover:opacity-100 leading-none"
					>
						×
					</span>
				</button>
			))}
		</div>
	);
}

function DocsCategory({ model }: { model: DocsCategoryModel }) {
	return (
		<div>
			<DocsCategoryHeader model={model} />
			{!model.collapsed && <DocsCategoryItems model={model} />}
		</div>
	);
}

function DocsCategoryHeader({ model }: { model: DocsCategoryModel }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={model.toggle}
			onDragOver={model.dragOver}
			onDragLeave={model.dragLeave}
			onDrop={model.drop}
			className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition group/cat ${
				model.dropActive
					? "bg-accent/15 ring-2 ring-accent/40"
					: "hover:bg-black/[0.03]"
			}`}
			aria-expanded={!model.collapsed}
		>
			<ChevronRight
				size={11}
				className={`text-text-3 flex-shrink-0 transition-transform duration-150 ${
					model.collapsed ? "" : "rotate-90"
				}`}
			/>
			<CategoryDot name={model.name} />
			<span
				className={`text-xs font-bold uppercase tracking-wider flex-1 text-left ${
					model.dropActive ? "text-accent" : "text-text-3"
				}`}
			>
				{model.name}
			</span>
			<span
				className={`text-xs tabular-nums ${
					model.dropActive ? "text-accent" : "text-text-3"
				}`}
			>
				{model.dropActive ? t("doc_drop_here") : model.docs.length}
			</span>
		</button>
	);
}

function CategoryDot({ name }: { name: string }) {
	return (
		<div
			style={{
				width: 8,
				height: 8,
				borderRadius: "50%",
				background: catColor(name),
				flexShrink: 0,
			}}
		/>
	);
}

function DocsCategoryItems({ model }: { model: DocsCategoryModel }) {
	return (
		<div
			className={
				model.view === "grid"
					? "grid grid-cols-2 gap-2 mt-1"
					: "flex flex-col gap-0.5 mt-0.5"
			}
		>
			{model.docs.map((doc) => {
				const itemProps = model.itemFor(doc);
				return model.view === "grid" ? (
					<DocCard key={doc.name} {...itemProps} />
				) : (
					<DocRow key={doc.name} {...itemProps} />
				);
			})}
		</div>
	);
}

interface BulkActionBarModel {
	selected: Set<string>;
	docList: DocSummary[];
}

interface BulkActionBarActions {
	clear: () => void;
	lock: () => void;
	unlock: () => void;
	recategorize: (cat: string) => void;
	delete: () => void;
	export: () => void;
}

interface BulkActionBarProps {
	model: BulkActionBarModel;
	actions: BulkActionBarActions;
}

function BulkActionBar({ model, actions }: BulkActionBarProps) {
	const bar = useBulkActionBarModel(model, actions);
	const t = useT();
	return (
		<div className="sticky bottom-2 mx-1 mt-2 rounded-xl bg-panel shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 p-2 flex items-center gap-1.5 z-40">
			<span className="px-2 text-2xs font-bold text-text-3 tabular-nums">
				{t("bulk_selected", { count: String(model.selected.size) })}
			</span>
			<div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">
				<BulkCategoryPicker model={bar.categoryPicker} />
				<BulkExportButton onClick={actions.export} />
				{bar.anyUnlocked && (
					<BulkTextButton onClick={actions.lock} label={t("doc_lock")} />
				)}
				{bar.anyLocked && (
					<BulkTextButton onClick={actions.unlock} label={t("doc_unlock")} />
				)}
				<BulkDeleteButton model={bar.deleteButton} />
			</div>
			<button
				type="button"
				onClick={actions.clear}
				aria-label={t("bulk_clear")}
				className="w-7 h-7 rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.05] transition"
			>
				<span aria-hidden className="text-base leading-none">
					×
				</span>
			</button>
		</div>
	);
}

interface BulkActionBarViewModel {
	anyUnlocked: boolean;
	anyLocked: boolean;
	categoryPicker: BulkCategoryPickerModel;
	deleteButton: BulkDeleteButtonModel;
}

interface BulkCategoryPickerModel {
	categories: string[];
	show: boolean;
	creating: boolean;
	pickerRef: React.RefObject<HTMLDivElement | null>;
	newInputRef: React.RefObject<HTMLInputElement | null>;
	toggle: () => void;
	startCreating: () => void;
	cancelCreating: () => void;
	commit: (cat: string) => void;
	recategorize: (cat: string) => void;
}

interface BulkDeleteButtonModel {
	confirming: boolean;
	disabled: boolean;
	request: () => void;
	confirm: () => void;
}

function useBulkActionBarModel(
	model: BulkActionBarModel,
	actions: BulkActionBarActions,
): BulkActionBarViewModel {
	const { selected, docList } = model;
	const [showCatPicker, setShowCatPicker] = useState(false);
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
	const [creatingCat, setCreatingCat] = useState(false);
	const pickerRef = useRef<HTMLDivElement>(null);
	const newCatInputRef = useRef<HTMLInputElement>(null);
	useFocusNewCategoryInput(creatingCat, newCatInputRef);
	useCloseCategoryPicker(showCatPicker, pickerRef, () => {
		setShowCatPicker(false);
		setCreatingCat(false);
	});
	const selectedDocs = docList.filter((doc) => selected.has(doc.name));
	return {
		anyUnlocked: selectedDocs.some((doc) => doc.locked !== true),
		anyLocked: selectedDocs.some((doc) => doc.locked === true),
		categoryPicker: createBulkCategoryPickerModel({
			docList,
			actions,
			showCatPicker,
			setShowCatPicker,
			creatingCat,
			setCreatingCat,
			pickerRef,
			newCatInputRef,
		}),
		deleteButton: createBulkDeleteButtonModel({
			docList,
			selectedDocs,
			showConfirmDelete,
			setShowConfirmDelete,
			deleteSelected: actions.delete,
		}),
	};
}

function useFocusNewCategoryInput(
	creatingCat: boolean,
	inputRef: React.RefObject<HTMLInputElement | null>,
) {
	useEffect(() => {
		if (creatingCat) inputRef.current?.focus();
	}, [creatingCat, inputRef]);
}

function useCloseCategoryPicker(
	showCatPicker: boolean,
	pickerRef: React.RefObject<HTMLDivElement | null>,
	close: () => void,
) {
	useEffect(() => {
		if (!showCatPicker) return;
		const onDocClick = (event: MouseEvent) => {
			if (!pickerRef.current?.contains(event.target as Node)) close();
		};
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, [close, pickerRef, showCatPicker]);
}

interface BulkCategoryPickerFactoryArgs {
	docList: DocSummary[];
	actions: BulkActionBarActions;
	showCatPicker: boolean;
	setShowCatPicker: React.Dispatch<React.SetStateAction<boolean>>;
	creatingCat: boolean;
	setCreatingCat: React.Dispatch<React.SetStateAction<boolean>>;
	pickerRef: React.RefObject<HTMLDivElement | null>;
	newCatInputRef: React.RefObject<HTMLInputElement | null>;
}

function createBulkCategoryPickerModel(
	args: BulkCategoryPickerFactoryArgs,
): BulkCategoryPickerModel {
	return {
		categories: [
			...new Set(args.docList.map((doc) => doc.category || "general")),
		].sort(),
		show: args.showCatPicker,
		creating: args.creatingCat,
		pickerRef: args.pickerRef,
		newInputRef: args.newCatInputRef,
		toggle: () => args.setShowCatPicker((show) => !show),
		startCreating: () => args.setCreatingCat(true),
		cancelCreating: () => args.setCreatingCat(false),
		commit: (cat) => commitNewCategory(cat, args),
		recategorize: (cat) => {
			args.setShowCatPicker(false);
			args.actions.recategorize(cat);
		},
	};
}

function commitNewCategory(cat: string, args: BulkCategoryPickerFactoryArgs) {
	const value = cat.trim();
	args.setCreatingCat(false);
	args.setShowCatPicker(false);
	if (value) args.actions.recategorize(value);
}

interface BulkDeleteFactoryArgs {
	docList: DocSummary[];
	selectedDocs: DocSummary[];
	showConfirmDelete: boolean;
	setShowConfirmDelete: React.Dispatch<React.SetStateAction<boolean>>;
	deleteSelected: () => void;
}

function createBulkDeleteButtonModel(
	args: BulkDeleteFactoryArgs,
): BulkDeleteButtonModel {
	const anyDeletable = args.selectedDocs.some((doc) => doc.locked !== true);
	const unlockedCount = args.selectedDocs.filter(
		(doc) => doc.locked !== true,
	).length;
	return {
		confirming: args.showConfirmDelete,
		disabled: !anyDeletable || args.docList.length - unlockedCount < 1,
		request: () => args.setShowConfirmDelete(true),
		confirm: () => {
			args.setShowConfirmDelete(false);
			args.deleteSelected();
		},
	};
}

function BulkCategoryPicker({ model }: { model: BulkCategoryPickerModel }) {
	const t = useT();
	return (
		<div className="relative">
			<button
				type="button"
				onClick={model.toggle}
				className="px-2 py-1 rounded-md text-xs font-semibold text-text-1 hover:bg-black/[0.05] transition"
			>
				{t("bulk_move_category")}
			</button>
			{model.show && <BulkCategoryMenu model={model} />}
		</div>
	);
}

function BulkCategoryMenu({ model }: { model: BulkCategoryPickerModel }) {
	return (
		<div
			ref={model.pickerRef}
			className="absolute bottom-[calc(100%+4px)] left-0 z-50 w-56 bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 overflow-hidden py-1"
		>
			{!model.creating &&
				model.categories.map((cat) => (
					<button
						key={cat}
						type="button"
						onClick={() => model.recategorize(cat)}
						className="w-full text-left px-3 py-1.5 text-sm hover:bg-black/[0.05] transition"
					>
						{cat}
					</button>
				))}
			{!model.creating && <div className="h-px bg-black/[0.06] my-1" />}
			{model.creating ? (
				<NewCategoryInput model={model} />
			) : (
				<NewCategoryButton onClick={model.startCreating} />
			)}
		</div>
	);
}

function NewCategoryInput({ model }: { model: BulkCategoryPickerModel }) {
	const t = useT();
	return (
		<input
			ref={model.newInputRef}
			type="text"
			placeholder={t("bulk_new_category")}
			onKeyDown={(event) => handleNewCategoryKey(event, model)}
			onBlur={model.cancelCreating}
			className="w-full px-3 py-1.5 text-sm bg-transparent outline-none placeholder:text-text-3 border-b border-accent/40"
		/>
	);
}

function handleNewCategoryKey(
	event: React.KeyboardEvent<HTMLInputElement>,
	model: BulkCategoryPickerModel,
) {
	if (event.key === "Enter") {
		model.commit(event.currentTarget.value);
	} else if (event.key === "Escape") {
		event.currentTarget.value = "";
		model.cancelCreating();
	}
}

function NewCategoryButton({ onClick }: { onClick: () => void }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={onClick}
			className="w-full text-left px-3 py-1.5 text-sm text-accent hover:bg-accent/5 transition font-semibold"
		>
			+ {t("bulk_new_category_cta")}
		</button>
	);
}

function BulkExportButton({ onClick }: { onClick: () => void }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={onClick}
			className="px-2 py-1 rounded-md text-xs font-semibold text-text-1 hover:bg-black/[0.05] transition inline-flex items-center gap-1"
		>
			<Download size={12} />
			{t("bulk_export_maket")}
		</button>
	);
}

function BulkTextButton({
	onClick,
	label,
}: {
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="px-2 py-1 rounded-md text-xs font-semibold text-text-1 hover:bg-black/[0.05] transition"
		>
			{label}
		</button>
	);
}

function BulkDeleteButton({ model }: { model: BulkDeleteButtonModel }) {
	const t = useT();
	if (model.confirming) {
		return (
			<button
				type="button"
				onClick={model.confirm}
				className="px-2 py-1 rounded-md text-xs font-bold bg-danger text-white hover:brightness-110 transition"
			>
				{t("bulk_confirm_delete")}
			</button>
		);
	}
	return (
		<button
			type="button"
			disabled={model.disabled}
			onClick={model.request}
			className={`px-2 py-1 rounded-md text-xs font-semibold transition ${
				model.disabled
					? "text-text-3 cursor-not-allowed"
					: "text-danger hover:bg-danger-soft"
			}`}
		>
			{t("doc_delete")}
		</button>
	);
}

interface DocItemModel {
	doc: DocSummary;
	onWs: boolean;
	selected: boolean;
	menuOpen: boolean;
	mode: RowMode;
	canDelete: boolean;
	dragging: boolean;
}

interface DocItemActions {
	click: (e: React.MouseEvent) => void;
	openMenu: () => void;
	closeMenu: () => void;
	changeMode: (mode: RowMode) => void;
	dragStart: (e: React.DragEvent) => void;
	dragEnd: (e: React.DragEvent) => void;
}

interface DocItemProps {
	model: DocItemModel;
	actions: DocItemActions;
}

function DocCard({ model, actions }: DocItemProps) {
	const meta = useDocItemMeta(model);
	const menuButtonRef = useRef<HTMLButtonElement>(null);

	return (
		<div
			className={`relative group/card ${model.dragging ? "opacity-40" : ""}`}
			draggable={meta.dragEnabled}
			onDragStart={(event) => handleItemDragStart(event, meta, actions)}
			onDragEnd={actions.dragEnd}
		>
			<DocCardThumb model={model} meta={meta} actions={actions} />
			<DocCardFooter
				model={model}
				meta={meta}
				actions={actions}
				anchorRef={menuButtonRef}
			/>
			<DocItemMenu
				model={model}
				meta={meta}
				actions={actions}
				anchorRef={menuButtonRef}
			/>
		</div>
	);
}

function DocRow({ model, actions }: DocItemProps) {
	const meta = useDocItemMeta(model);
	const menuButtonRef = useRef<HTMLButtonElement>(null);

	return (
		<div
			className={`relative group ${model.dragging ? "opacity-40" : ""}`}
			draggable={meta.dragEnabled}
			onDragStart={(event) => handleItemDragStart(event, meta, actions)}
			onDragEnd={actions.dragEnd}
		>
			<DocRowMain model={model} meta={meta} actions={actions} />
			<DocRowMenuButton
				model={model}
				meta={meta}
				actions={actions}
				anchorRef={menuButtonRef}
			/>
			<DocItemMenu
				model={model}
				meta={meta}
				actions={actions}
				anchorRef={menuButtonRef}
			/>
		</div>
	);
}

interface DocItemMeta {
	locked: boolean;
	editing: boolean;
	confirming: boolean;
	dragEnabled: boolean;
}

function useDocItemMeta(model: DocItemModel): DocItemMeta {
	return {
		locked: model.doc.locked === true,
		editing: model.mode.kind === "rename" || model.mode.kind === "duplicate",
		confirming: model.mode.kind === "confirm-delete",
		dragEnabled: model.mode.kind === "idle",
	};
}

function handleItemDragStart(
	event: React.DragEvent,
	meta: DocItemMeta,
	actions: DocItemActions,
) {
	if (!meta.dragEnabled) {
		event.preventDefault();
		return;
	}
	actions.dragStart(event);
}

interface DocItemRenderProps extends DocItemProps {
	meta: DocItemMeta;
}

function DocCardThumb({ model, meta, actions }: DocItemRenderProps) {
	const doc = model.doc;
	const cacheToken = doc.updatedAt ?? String(Date.now());
	const thumbSrc = `/api/thumb?name=${encodeURIComponent(doc.name)}&page=1&w=480&t=${encodeURIComponent(cacheToken)}`;
	return (
		<button
			type="button"
			onClick={actions.click}
			className={`relative block w-full overflow-hidden rounded-xl border transition bg-white ${cardBorderClass(model)}`}
			style={{ aspectRatio: `1 / ${docAspectRatio(doc)}` }}
		>
			<img
				src={thumbSrc}
				alt={doc.name}
				loading="lazy"
				className="absolute inset-0 w-full h-full object-cover"
				style={{ background: "#fff" }}
				draggable={false}
			/>
			{model.selected && (
				<DocSelectedMark className="absolute top-1.5 right-1.5" />
			)}
			{meta.locked && <DocLockedMark className="absolute top-1.5 left-1.5" />}
			<DocCardBadges doc={doc} onWs={model.onWs} />
		</button>
	);
}

function cardBorderClass(model: DocItemModel): string {
	if (model.selected) {
		return "border-accent ring-4 ring-accent/30 shadow-[0_8px_24px_rgba(16,185,129,0.18)]";
	}
	if (model.onWs) {
		return "border-accent/40 ring-2 ring-accent/20 shadow-[0_8px_24px_rgba(16,185,129,0.12)]";
	}
	return "border-black/5 hover:border-black/10 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]";
}

function DocSelectedMark({ className }: { className: string }) {
	return (
		<span
			className={`${className} w-5 h-5 rounded-md bg-accent text-white flex items-center justify-center text-2xs font-bold`}
		>
			✓
		</span>
	);
}

function DocLockedMark({ className }: { className: string }) {
	return (
		<span
			className={`${className} w-5 h-5 rounded-md bg-black/60 text-white flex items-center justify-center`}
		>
			<Lock size={10} />
		</span>
	);
}

function DocCardBadges({ doc, onWs }: { doc: DocSummary; onWs: boolean }) {
	return (
		<span className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
			{(doc.rating ?? 0) > 0 && (
				<span className="px-1.5 py-0.5 rounded-md bg-amber-100/95 text-amber-600 text-2xs font-bold backdrop-blur">
					★{doc.rating}
				</span>
			)}
			{onWs && <DocSelectedMark className="" />}
		</span>
	);
}

interface DocCardFooterProps extends DocItemRenderProps {
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}

function DocCardFooter({
	model,
	meta,
	actions,
	anchorRef,
}: DocCardFooterProps) {
	if (meta.editing) {
		return (
			<div className="mt-1">
				<DocInlineNameEditor model={model} actions={actions} />
			</div>
		);
	}
	if (meta.confirming) {
		return (
			<div className="mt-1">
				<DocDeleteHold model={model} actions={actions} />
			</div>
		);
	}
	return (
		<DocCardSummary model={model} actions={actions} anchorRef={anchorRef} />
	);
}

function DocCardSummary({
	model,
	actions,
	anchorRef,
}: {
	model: DocItemModel;
	actions: DocItemActions;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
	return (
		<div className="mt-1 px-1 flex items-center gap-1.5">
			<CharteDot doc={model.doc} />
			<div className="flex-1 min-w-0">
				<div
					className={`text-xs truncate ${model.onWs ? "font-bold text-accent" : "font-semibold text-text-1"}`}
				>
					{model.doc.name}
				</div>
				<DocCardMetadata doc={model.doc} />
			</div>
			<DocMenuButton
				model={model}
				actions={actions}
				anchorRef={anchorRef}
				size="card"
			/>
		</div>
	);
}

function DocCardMetadata({ doc }: { doc: DocSummary }) {
	return (
		<div className="flex items-center gap-1 text-2xs text-text-3">
			<span className="font-bold">{doc.format}</span>
			<span>{doc.pageCount ?? 1}p</span>
			{(doc.rating ?? 0) > 0 && (
				<span className="text-amber-500">★{doc.rating}</span>
			)}
			<DocDraftPill doc={doc} />
		</div>
	);
}

function DocRowMain({ model, meta, actions }: DocItemRenderProps) {
	if (meta.editing)
		return <DocInlineNameEditor model={model} actions={actions} />;
	if (meta.confirming) return <DocDeleteHold model={model} actions={actions} />;
	return <DocRowButton model={model} meta={meta} actions={actions} />;
}

function DocRowButton({ model, meta, actions }: DocItemRenderProps) {
	return (
		<button
			type="button"
			onClick={actions.click}
			className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${rowBackgroundClass(model)}`}
		>
			<DocRowIcon onWs={model.onWs} />
			<div className="flex-1 min-w-0">
				<DocRowTitle model={model} meta={meta} />
				<DocRowMetadata doc={model.doc} />
			</div>
			{model.onWs && !model.menuOpen && !meta.confirming && (
				<span className="text-2xs font-bold text-accent mr-6">✓</span>
			)}
		</button>
	);
}

function rowBackgroundClass(model: DocItemModel): string {
	if (model.selected) return "bg-accent/10 ring-2 ring-accent/30";
	return model.onWs ? "bg-accent/5" : "hover:bg-black/[0.03]";
}

function DocRowIcon({ onWs }: { onWs: boolean }) {
	return (
		<div
			className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
				onWs ? "bg-accent/10" : "bg-input"
			}`}
		>
			<FileText size={14} className={onWs ? "text-accent" : "text-text-3"} />
		</div>
	);
}

function DocRowTitle({
	model,
	meta,
}: {
	model: DocItemModel;
	meta: DocItemMeta;
}) {
	const t = useT();
	return (
		<div
			className={`text-base truncate flex items-center gap-1.5 ${
				model.onWs ? "font-bold text-accent" : "font-medium text-text-1"
			}`}
		>
			{meta.locked && (
				<Lock
					size={11}
					className="text-text-3 flex-shrink-0"
					aria-label={t("doc_locked")}
				/>
			)}
			<CharteDot doc={model.doc} />
			<span className="truncate">{model.doc.name}</span>
		</div>
	);
}

function CharteDot({ doc }: { doc: DocSummary }) {
	if (!doc.charteColor) return null;
	return (
		<span
			className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/5"
			style={{ background: doc.charteColor }}
			title={doc.charte || ""}
		/>
	);
}

function DocRowMetadata({ doc }: { doc: DocSummary }) {
	return (
		<div className="flex items-center gap-1.5 mt-0.5 text-2xs text-text-3">
			<span className="font-bold">{doc.format}</span>
			<span>{doc.pageCount ?? 1}p</span>
			{(doc.rating ?? 0) > 0 && <DocRating rating={doc.rating ?? 0} />}
			<DocDraftPill doc={doc} />
			{doc.updatedAt && <DocUpdatedAt doc={doc} />}
		</div>
	);
}

function DocRating({ rating }: { rating: number }) {
	return (
		<span
			className="flex items-center gap-0.5 text-amber-500"
			title={`rating ${rating}`}
		>
			<span className="leading-none">★</span>
			<span className="tabular-nums">{rating}</span>
		</span>
	);
}

function DocDraftPill({ doc }: { doc: DocSummary }) {
	if (!doc.emailDraftUrl) return null;
	return (
		<span className="ml-auto">
			<DraftPill kind={doc.emailDraftRole ?? "body"} url={doc.emailDraftUrl} />
		</span>
	);
}

function DocUpdatedAt({ doc }: { doc: DocSummary }) {
	return (
		<span
			className={`${doc.emailDraftUrl ? "" : "ml-auto"} text-text-3/80 tabular-nums`}
			title={doc.updatedAt}
		>
			{relativeTime(doc.updatedAt, navigator.language)}
		</span>
	);
}

interface DocRowMenuButtonProps extends DocItemRenderProps {
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}

function DocRowMenuButton({
	model,
	meta,
	actions,
	anchorRef,
}: DocRowMenuButtonProps) {
	if (meta.editing || meta.confirming) return null;
	return (
		<DocMenuButton
			model={model}
			actions={actions}
			anchorRef={anchorRef}
			size="row"
		/>
	);
}

function DocMenuButton({
	model,
	actions,
	anchorRef,
	size,
}: {
	model: DocItemModel;
	actions: DocItemActions;
	anchorRef: React.RefObject<HTMLButtonElement | null>;
	size: "card" | "row";
}) {
	const t = useT();
	const rowPosition = "absolute right-1.5 top-1/2 -translate-y-1/2";
	const buttonSize = size === "card" ? "w-6 h-6" : `w-7 h-7 ${rowPosition}`;
	const hover =
		size === "card"
			? "group-hover/card:opacity-100"
			: "group-hover:opacity-100";
	return (
		<button
			ref={anchorRef}
			type="button"
			aria-label={t("doc_menu")}
			onClick={(event) => toggleDocMenu(event, model, actions)}
			className={`${buttonSize} rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.06] transition ${
				model.menuOpen
					? "bg-black/[0.06]"
					: `opacity-0 ${hover} focus:opacity-100`
			}`}
		>
			<MoreVertical size={size === "card" ? 13 : 14} />
		</button>
	);
}

function toggleDocMenu(
	event: React.MouseEvent,
	model: DocItemModel,
	actions: DocItemActions,
) {
	event.stopPropagation();
	if (model.menuOpen) actions.closeMenu();
	else actions.openMenu();
}

function DocInlineNameEditor({ model, actions }: DocItemProps) {
	const t = useT();
	return (
		<InlineNameEditor
			initial={
				model.mode.kind === "rename" ? model.doc.name : `${model.doc.name} copy`
			}
			placeholder={
				model.mode.kind === "rename"
					? t("doc_rename_prompt")
					: t("doc_duplicate_prompt")
			}
			onCommit={(value) => commitDocName(value, model, actions)}
			onCancel={() => actions.changeMode({ kind: "idle" })}
		/>
	);
}

function commitDocName(
	value: string,
	model: DocItemModel,
	actions: DocItemActions,
) {
	const trimmed = value.trim();
	actions.changeMode({ kind: "idle" });
	if (!trimmed) return;
	if (model.mode.kind === "rename") {
		if (trimmed !== model.doc.name) sendRenameDoc(model.doc.name, trimmed);
	} else {
		sendDuplicateDoc(model.doc.name, trimmed);
	}
}

function DocDeleteHold({ model, actions }: DocItemProps) {
	const t = useT();
	return (
		<HoldToDelete
			label={t("doc_delete_hold", { name: model.doc.name })}
			onConfirm={() => {
				actions.changeMode({ kind: "idle" });
				sendDeleteDoc(model.doc.name);
			}}
			onCancel={() => actions.changeMode({ kind: "idle" })}
		/>
	);
}

interface DocItemMenuProps extends DocItemRenderProps {
	anchorRef: React.RefObject<HTMLButtonElement | null>;
}

function DocItemMenu({ model, meta, actions, anchorRef }: DocItemMenuProps) {
	if (!model.menuOpen) return null;
	return (
		<DocMenu
			model={{
				doc: model.doc,
				canDelete: model.canDelete,
				locked: meta.locked,
			}}
			actions={{
				close: actions.closeMenu,
				rename: () => changeDocMenuMode(actions, "rename"),
				duplicate: () => changeDocMenuMode(actions, "duplicate"),
				requestDelete: () => changeDocMenuMode(actions, "confirm-delete"),
			}}
			anchorRef={anchorRef}
		/>
	);
}

function changeDocMenuMode(actions: DocItemActions, kind: RowMode["kind"]) {
	actions.closeMenu();
	actions.changeMode({ kind } as RowMode);
}

interface InlineNameEditorProps {
	initial: string;
	placeholder: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
}

function InlineNameEditor({
	initial,
	placeholder,
	onCommit,
	onCancel,
}: InlineNameEditorProps) {
	const [value, setValue] = useState(initial);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		const base = initial.replace(/ copy$/, "");
		el.setSelectionRange(0, base.length);
	}, [initial]);

	return (
		<div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-accent/5 ring-2 ring-accent/30">
			<div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-accent/10">
				<Pencil size={13} className="text-accent" />
			</div>
			<input
				ref={inputRef}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						onCommit(value);
					} else if (e.key === "Escape") {
						e.preventDefault();
						onCancel();
					}
				}}
				onBlur={() => onCancel()}
				placeholder={placeholder}
				className="flex-1 min-w-0 bg-transparent outline-none text-base font-medium text-text-1 placeholder:text-text-3"
			/>
		</div>
	);
}

interface DocMenuModel {
	doc: DocSummary;
	canDelete: boolean;
	locked: boolean;
}

interface DocMenuActions {
	close: () => void;
	rename: () => void;
	duplicate: () => void;
	requestDelete: () => void;
}

interface DocMenuProps {
	model: DocMenuModel;
	actions: DocMenuActions;
	anchorRef: React.RefObject<HTMLElement | null>;
}

function DocMenu({ model, actions, anchorRef }: DocMenuProps) {
	const menu = useDocMenuModel(model, actions, anchorRef);
	if (!menu.pos) return null;
	return createPortal(<DocMenuView menu={menu} />, document.body);
}

interface DocMenuViewModel {
	doc: DocSummary;
	canDelete: boolean;
	locked: boolean;
	ref: React.RefObject<HTMLDivElement | null>;
	pos: { top: number; right: number } | null;
	actions: DocMenuActions;
	copy: () => Promise<void>;
	toggleLock: () => void;
}

function useDocMenuModel(
	model: DocMenuModel,
	actions: DocMenuActions,
	anchorRef: React.RefObject<HTMLElement | null>,
): DocMenuViewModel {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

	useLayoutEffect(() => {
		const a = anchorRef.current;
		if (!a) return;
		const rect = a.getBoundingClientRect();
		const MENU_W = 192;
		const GAP = 4;
		const top = rect.bottom + GAP;
		const right = Math.max(8, window.innerWidth - rect.right);
		const ESTIMATED_H = 210;
		const flipped =
			top + ESTIMATED_H > window.innerHeight - 8
				? Math.max(8, rect.top - GAP - ESTIMATED_H)
				: top;
		void MENU_W;
		setPos({ top: flipped, right });
	}, [anchorRef]);

	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			if (anchorRef.current?.contains(e.target as Node)) return;
			actions.close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") actions.close();
		};
		const onScroll = () => actions.close();
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [actions, anchorRef]);

	const copy = async () => {
		await copyToClipboard(model.doc.name);
		actions.close();
	};

	const toggleLock = () => {
		sendLockDoc(model.doc.name, !model.locked);
		actions.close();
	};

	return { ...model, ref, pos, actions, copy, toggleLock };
}

// code-moniker: ignore[smell-feature-envy-local]
// Pure React view: composing menu items is the component's adapter role, not misplaced domain behavior.
function DocMenuView({ menu }: { menu: DocMenuViewModel }) {
	const t = useT();
	return (
		<div
			ref={menu.ref}
			className="fixed z-[210] w-48 bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 overflow-hidden py-1"
			style={{ top: menu.pos?.top, right: menu.pos?.right }}
		>
			<MenuItem icon={<Copy size={13} />} onClick={menu.copy}>
				{t("doc_copy_name")}
			</MenuItem>
			<MenuItem
				icon={<Pencil size={13} />}
				onClick={menu.actions.rename}
				disabled={menu.locked}
			>
				{t("doc_rename")}
			</MenuItem>
			<MenuItem icon={<Files size={13} />} onClick={menu.actions.duplicate}>
				{t("doc_duplicate")}
			</MenuItem>
			<MenuItem
				icon={<Download size={13} />}
				onClick={() => {
					exportMaketBundle([menu.doc.name]);
					menu.actions.close();
				}}
			>
				{t("doc_export_maket")}
			</MenuItem>
			<MenuItem
				icon={menu.locked ? <Unlock size={13} /> : <Lock size={13} />}
				onClick={menu.toggleLock}
			>
				{menu.locked ? t("doc_unlock") : t("doc_lock")}
			</MenuItem>
			<div className="h-px bg-black/[0.06] my-1" />
			<MenuItem
				icon={<Trash2 size={13} />}
				onClick={menu.actions.requestDelete}
				disabled={menu.locked || !menu.canDelete}
				danger
			>
				{t("doc_delete")}
			</MenuItem>
		</div>
	);
}

interface MenuItemProps {
	icon: React.ReactNode;
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
}

function MenuItem({
	icon,
	children,
	onClick,
	disabled,
	danger,
}: MenuItemProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition ${
				disabled
					? "text-text-3 cursor-not-allowed"
					: danger
						? "text-danger hover:bg-danger-soft"
						: "text-text-1 hover:bg-black/[0.05]"
			}`}
		>
			<span className="flex-shrink-0">{icon}</span>
			<span className="flex-1 truncate">{children}</span>
		</button>
	);
}
