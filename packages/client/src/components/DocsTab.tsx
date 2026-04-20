import { computeCanvasDims, DEFAULT_ORIENTATION } from "@maket/shared";
import {
	ChevronRight,
	Copy,
	Files,
	FileText,
	LayoutGrid,
	List,
	Lock,
	MoreVertical,
	Pencil,
	Trash2,
	Unlock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

async function copyToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* fall through to execCommand */
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
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
	} catch {
		/* localStorage may be unavailable (private mode) */
	}
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
	const t = useT();
	const docList = useStore((s) => s.docList);
	const workspaceDocNames = useWorkspaceDocNames();
	const barPosition = useStore((s) => s.barPosition);
	const removeDoc = useStore((s) => s.removeDocFromWorkspace);
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
	const [view, setView] = useState<View>(() => {
		const stored = localStorage.getItem(VIEW_KEY);
		return stored === "grid" ? "grid" : "list";
	});
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [lastClicked, setLastClicked] = useState<string | null>(null);

	// Escape clears the selection.
	useEffect(() => {
		if (selected.size === 0) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSelected(new Set());
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [selected.size]);

	const setViewAndPersist = (v: View) => {
		setView(v);
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {
			/* private mode */
		}
	};

	const toggleCategory = (cat: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(cat)) next.delete(cat);
			else next.add(cat);
			saveCollapsed(next);
			return next;
		});
	};

	// Auto-expand a category when the search narrows the list down to just
	// that one — collapsed state is only meaningful when you're browsing.
	const searching = search.trim().length > 0;

	const query = parseQuery(search);
	const filtered = docList.filter((d) => matchesQuery(d, query));

	const chips: QueryChip[] = [];
	if (query.category) {
		chips.push({
			key: "cat",
			label: `@${query.category}`,
			onRemove: () =>
				setSearch(
					stripToken(search, (t) => t.toLowerCase() === `@${query.category}`),
				),
		});
	}
	if (query.locked !== null) {
		const tok = query.locked ? "#locked" : "#unlocked";
		chips.push({
			key: "lock",
			label: tok,
			onRemove: () => setSearch(stripToken(search, (t) => t === tok)),
		});
	}
	if (query.minRating > 0) {
		chips.push({
			key: "rating",
			label: `≥ ${"★".repeat(query.minRating)}`,
			onRemove: () => setSearch(stripToken(search, (t) => /^:\d$/.test(t))),
		});
	}

	// Group by category
	const grouped = new Map<string, typeof docList>();
	for (const d of filtered) {
		const cat = d.category || "general";
		if (!grouped.has(cat)) grouped.set(cat, []);
		grouped.get(cat)?.push(d);
	}

	const isOnWorkspace = (name: string) => workspaceDocNames.includes(name);

	const toggleDoc = (name: string) => {
		if (isOnWorkspace(name)) {
			removeDoc(name);
		} else {
			sendLoadDoc(name);
		}
	};

	// Flat ORDER OF VISIBLE docs across categories — drives shift-range
	// selection. A search query forces every category open (same logic as
	// `isCollapsed` below); otherwise we skip docs inside a collapsed
	// category so a shift-click never silently selects off-screen rows.
	const flatOrder = [...grouped.entries()]
		.filter(([cat]) => searching || !collapsed.has(cat))
		.flatMap(([, docs]) => docs.map((d) => d.name));

	const handleRowClick = (name: string, e: React.MouseEvent) => {
		if (e.metaKey || e.ctrlKey) {
			e.preventDefault();
			setSelected((prev) => {
				const next = new Set(prev);
				if (next.has(name)) next.delete(name);
				else next.add(name);
				return next;
			});
			setLastClicked(name);
			return;
		}
		if (e.shiftKey && lastClicked) {
			e.preventDefault();
			const from = flatOrder.indexOf(lastClicked);
			const to = flatOrder.indexOf(name);
			if (from >= 0 && to >= 0) {
				const [lo, hi] = from < to ? [from, to] : [to, from];
				setSelected((prev) => {
					const next = new Set(prev);
					for (let i = lo; i <= hi; i++) {
						const n = flatOrder[i];
						if (n) next.add(n);
					}
					return next;
				});
			}
			return;
		}
		// Plain click: clear any selection and do the default workspace toggle.
		if (selected.size > 0) setSelected(new Set());
		setLastClicked(name);
		toggleDoc(name);
	};

	const clearSelection = () => setSelected(new Set());

	const bulkLock = (locked: boolean) => {
		for (const name of selected) {
			const d = docList.find((x) => x.name === name);
			if (!d) continue;
			if ((d.locked === true) !== locked) sendLockDoc(name, locked);
		}
		clearSelection();
	};

	const bulkRecategorize = (cat: string) => {
		const trimmed = cat.trim();
		if (!trimmed) return;
		for (const name of selected) {
			const d = docList.find((x) => x.name === name);
			if (!d || d.category === trimmed || d.locked === true) continue;
			wsSend({ type: "update_meta", docName: name, category: trimmed });
		}
		clearSelection();
	};

	const bulkDelete = () => {
		// Unselect the doc we're about to delete, one by one. Server refuses
		// deleting the last doc, so we stop once only one would remain.
		const remaining = docList.length - selected.size;
		if (remaining < 1) {
			// Would empty the workspace — bail and let the user narrow down.
			return;
		}
		for (const name of selected) {
			const d = docList.find((x) => x.name === name);
			if (!d || d.locked === true) continue;
			sendDeleteDoc(name);
		}
		clearSelection();
	};

	return (
		<div
			className={`flex ${barPosition === "bottom" ? "flex-col-reverse" : "flex-col"} gap-2 p-3`}
		>
			{/* Search + view toggle */}
			<div className="px-1 flex flex-col gap-1.5">
				<div className="flex items-center gap-1.5">
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={t("search_hint")}
						className="flex-1 min-w-0 px-3 py-2 bg-input rounded-lg text-base outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
					/>
					<div className="flex rounded-lg bg-input p-0.5">
						<button
							type="button"
							onClick={() => setViewAndPersist("list")}
							aria-label={t("view_list")}
							title={t("view_list")}
							className={`w-8 h-8 rounded-md flex items-center justify-center transition ${
								view === "list"
									? "bg-panel shadow-sm text-text-1"
									: "text-text-3 hover:text-text-1"
							}`}
						>
							<List size={14} />
						</button>
						<button
							type="button"
							onClick={() => setViewAndPersist("grid")}
							aria-label={t("view_grid")}
							title={t("view_grid")}
							className={`w-8 h-8 rounded-md flex items-center justify-center transition ${
								view === "grid"
									? "bg-panel shadow-sm text-text-1"
									: "text-text-3 hover:text-text-1"
							}`}
						>
							<LayoutGrid size={14} />
						</button>
					</div>
				</div>
				{chips.length > 0 && (
					<div className="flex flex-wrap gap-1 px-1">
						{chips.map((c) => (
							<button
								key={c.key}
								type="button"
								onClick={c.onRemove}
								className="group flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-2xs font-semibold hover:bg-accent/15 transition"
							>
								<span>{c.label}</span>
								<span
									aria-hidden
									className="opacity-60 group-hover:opacity-100 leading-none"
								>
									×
								</span>
							</button>
						))}
					</div>
				)}
			</div>

			{/* Categories */}
			{[...grouped.entries()].map(([cat, docs]) => {
				const isCollapsed = !searching && collapsed.has(cat);
				const dropActive = dragOverCat === cat;
				return (
					<div key={cat}>
						{/* Category header — click toggles collapse, drop reassigns doc */}
						<button
							type="button"
							onClick={() => toggleCategory(cat)}
							onDragOver={(e) => {
								if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
								e.preventDefault();
								e.dataTransfer.dropEffect = "move";
								if (dragOverCat !== cat) setDragOverCat(cat);
							}}
							onDragLeave={(e) => {
								const related = e.relatedTarget as Node | null;
								if (!related || !e.currentTarget.contains(related))
									setDragOverCat((c) => (c === cat ? null : c));
							}}
							onDrop={(e) => {
								const name = e.dataTransfer.getData(DRAG_MIME);
								setDragOverCat(null);
								setDraggingName(null);
								if (!name) return;
								const src = docList.find((d) => d.name === name);
								if (!src || src.category === cat) return;
								wsSend({
									type: "update_meta",
									docName: name,
									category: cat,
								});
							}}
							className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition group/cat ${
								dropActive
									? "bg-accent/15 ring-2 ring-accent/40"
									: "hover:bg-black/[0.03]"
							}`}
							aria-expanded={!isCollapsed}
						>
							<ChevronRight
								size={11}
								className={`text-text-3 flex-shrink-0 transition-transform duration-150 ${
									isCollapsed ? "" : "rotate-90"
								}`}
							/>
							<div
								style={{
									width: 8,
									height: 8,
									borderRadius: "50%",
									background: catColor(cat),
									flexShrink: 0,
								}}
							/>
							<span
								className={`text-xs font-bold uppercase tracking-wider flex-1 text-left ${
									dropActive ? "text-accent" : "text-text-3"
								}`}
							>
								{cat}
							</span>
							<span
								className={`text-xs tabular-nums ${dropActive ? "text-accent" : "text-text-3"}`}
							>
								{dropActive ? t("doc_drop_here") : docs.length}
							</span>
						</button>

						{/* Docs — rows or thumbnail cards */}
						{!isCollapsed && (
							<div
								className={
									view === "grid"
										? "grid grid-cols-2 gap-2 mt-1"
										: "flex flex-col gap-0.5 mt-0.5"
								}
							>
								{docs.map((d) => {
									const rowProps = {
										doc: d,
										onWs: isOnWorkspace(d.name),
										selected: selected.has(d.name),
										onClick: (e: React.MouseEvent) => handleRowClick(d.name, e),
										menuOpen: menuFor === d.name,
										onMenuOpen: () => setMenuFor(d.name),
										onMenuClose: () => setMenuFor(null),
										mode:
											modeFor?.name === d.name
												? modeFor.mode
												: ({ kind: "idle" } as RowMode),
										onModeChange: (mode: RowMode) =>
											setModeFor(
												mode.kind === "idle" ? null : { name: d.name, mode },
											),
										canDelete: docList.length > 1,
										dragging: draggingName === d.name,
										onDragStart: (e: React.DragEvent) => {
											e.dataTransfer.effectAllowed = "move";
											e.dataTransfer.setData(DRAG_MIME, d.name);
											setDraggingName(d.name);
										},
										onDragEnd: () => {
											setDraggingName(null);
											setDragOverCat(null);
										},
									};
									return view === "grid" ? (
										<DocCard key={d.name} {...rowProps} />
									) : (
										<DocRow key={d.name} {...rowProps} />
									);
								})}
							</div>
						)}
					</div>
				);
			})}

			{filtered.length === 0 && (
				<div className="px-4 py-6 text-center text-base text-text-3">
					{t("no_document")}
				</div>
			)}

			{selected.size > 0 && (
				<BulkActionBar
					selected={selected}
					docList={docList}
					onClear={clearSelection}
					onLock={() => bulkLock(true)}
					onUnlock={() => bulkLock(false)}
					onRecategorize={bulkRecategorize}
					onDelete={bulkDelete}
				/>
			)}
		</div>
	);
}

interface BulkActionBarProps {
	selected: Set<string>;
	docList: DocSummary[];
	onClear: () => void;
	onLock: () => void;
	onUnlock: () => void;
	onRecategorize: (cat: string) => void;
	onDelete: () => void;
}

function BulkActionBar({
	selected,
	docList,
	onClear,
	onLock,
	onUnlock,
	onRecategorize,
	onDelete,
}: BulkActionBarProps) {
	const t = useT();
	const [showCatPicker, setShowCatPicker] = useState(false);
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
	const [creatingCat, setCreatingCat] = useState(false);
	const pickerRef = useRef<HTMLDivElement>(null);
	const newCatInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (creatingCat) newCatInputRef.current?.focus();
	}, [creatingCat]);

	// All known categories, deduped + sorted. A bulk "change to" picker is
	// most useful when it lists what already exists plus a free-form input.
	const categories = [
		...new Set(docList.map((d) => d.category || "general")),
	].sort();

	const selectedDocs = docList.filter((d) => selected.has(d.name));
	const anyUnlocked = selectedDocs.some((d) => d.locked !== true);
	const anyLocked = selectedDocs.some((d) => d.locked === true);
	const anyDeletable = selectedDocs.some((d) => d.locked !== true);
	const wouldEmptyLibrary =
		docList.length - selectedDocs.filter((d) => d.locked !== true).length < 1;

	// Close the category picker on outside click.
	useEffect(() => {
		if (!showCatPicker) return;
		const onDocClick = (e: MouseEvent) => {
			if (!pickerRef.current?.contains(e.target as Node)) {
				setShowCatPicker(false);
				setCreatingCat(false);
			}
		};
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, [showCatPicker]);

	return (
		<div className="sticky bottom-2 mx-1 mt-2 rounded-xl bg-panel shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 p-2 flex items-center gap-1.5 z-40">
			<span className="px-2 text-2xs font-bold text-text-3 tabular-nums">
				{t("bulk_selected", { count: String(selected.size) })}
			</span>
			<div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">
				<div className="relative">
					<button
						type="button"
						onClick={() => setShowCatPicker((s) => !s)}
						className="px-2 py-1 rounded-md text-xs font-semibold text-text-1 hover:bg-black/[0.05] transition"
					>
						{t("bulk_move_category")}
					</button>
					{showCatPicker && (
						<div
							ref={pickerRef}
							className="absolute bottom-[calc(100%+4px)] left-0 z-50 w-56 bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 overflow-hidden py-1"
						>
							{!creatingCat &&
								categories.map((cat) => (
									<button
										key={cat}
										type="button"
										onClick={() => {
											setShowCatPicker(false);
											onRecategorize(cat);
										}}
										className="w-full text-left px-3 py-1.5 text-sm hover:bg-black/[0.05] transition"
									>
										{cat}
									</button>
								))}
							{!creatingCat && <div className="h-px bg-black/[0.06] my-1" />}
							{creatingCat ? (
								<input
									ref={newCatInputRef}
									type="text"
									placeholder={t("bulk_new_category")}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											const value = e.currentTarget.value.trim();
											setCreatingCat(false);
											setShowCatPicker(false);
											if (value) onRecategorize(value);
										} else if (e.key === "Escape") {
											e.currentTarget.value = "";
											setCreatingCat(false);
										}
									}}
									onBlur={() => setCreatingCat(false)}
									className="w-full px-3 py-1.5 text-sm bg-transparent outline-none placeholder:text-text-3 border-b border-accent/40"
								/>
							) : (
								<button
									type="button"
									onClick={() => setCreatingCat(true)}
									className="w-full text-left px-3 py-1.5 text-sm text-accent hover:bg-accent/5 transition font-semibold"
								>
									+ {t("bulk_new_category_cta")}
								</button>
							)}
						</div>
					)}
				</div>
				{anyUnlocked && (
					<button
						type="button"
						onClick={onLock}
						className="px-2 py-1 rounded-md text-xs font-semibold text-text-1 hover:bg-black/[0.05] transition"
					>
						{t("doc_lock")}
					</button>
				)}
				{anyLocked && (
					<button
						type="button"
						onClick={onUnlock}
						className="px-2 py-1 rounded-md text-xs font-semibold text-text-1 hover:bg-black/[0.05] transition"
					>
						{t("doc_unlock")}
					</button>
				)}
				{showConfirmDelete ? (
					<button
						type="button"
						onClick={() => {
							setShowConfirmDelete(false);
							onDelete();
						}}
						className="px-2 py-1 rounded-md text-xs font-bold bg-danger text-white hover:brightness-110 transition"
					>
						{t("bulk_confirm_delete")}
					</button>
				) : (
					<button
						type="button"
						disabled={!anyDeletable || wouldEmptyLibrary}
						onClick={() => setShowConfirmDelete(true)}
						className={`px-2 py-1 rounded-md text-xs font-semibold transition ${
							!anyDeletable || wouldEmptyLibrary
								? "text-text-3 cursor-not-allowed"
								: "text-danger hover:bg-danger-soft"
						}`}
					>
						{t("doc_delete")}
					</button>
				)}
			</div>
			<button
				type="button"
				onClick={onClear}
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

interface DocRowProps {
	doc: DocSummary;
	onWs: boolean;
	selected: boolean;
	onClick: (e: React.MouseEvent) => void;
	menuOpen: boolean;
	onMenuOpen: () => void;
	onMenuClose: () => void;
	mode: RowMode;
	onModeChange: (mode: RowMode) => void;
	canDelete: boolean;
	dragging: boolean;
	onDragStart: (e: React.DragEvent) => void;
	onDragEnd: (e: React.DragEvent) => void;
}

/**
 * Grid-view card — a scaled iframe preview over the doc's first page plus
 * a caption strip. Uses the same mode state machine as DocRow so rename /
 * duplicate / confirm-delete flows stay consistent between views.
 */
function DocCard({
	doc,
	onWs,
	selected,
	onClick,
	menuOpen,
	onMenuOpen,
	onMenuClose,
	mode,
	onModeChange,
	canDelete,
	dragging,
	onDragStart,
	onDragEnd,
}: DocRowProps) {
	const t = useT();
	const locked = doc.locked === true;
	const editing = mode.kind === "rename" || mode.kind === "duplicate";
	const confirming = mode.kind === "confirm-delete";
	const dragEnabled = mode.kind === "idle";
	const aspect = docAspectRatio(doc);
	// Real page snapshot served by the server. `t=<updatedAt>` acts both as
	// a cache-key on the ThumbnailService and as a cache-buster in the
	// browser: when the doc changes, updatedAt changes, url changes, the
	// browser refetches. Missing updatedAt falls back to Date.now() so a
	// stale server-side snapshot never survives a hot-reload.
	const cacheToken = doc.updatedAt ?? String(Date.now());
	const thumbSrc = `/api/thumb?name=${encodeURIComponent(doc.name)}&page=1&w=480&t=${encodeURIComponent(cacheToken)}`;

	return (
		<div
			className={`relative group/card ${dragging ? "opacity-40" : ""}`}
			draggable={dragEnabled}
			onDragStart={(e) => {
				if (!dragEnabled) {
					e.preventDefault();
					return;
				}
				onDragStart(e);
			}}
			onDragEnd={onDragEnd}
		>
			<button
				type="button"
				onClick={onClick}
				className={`relative block w-full overflow-hidden rounded-xl border transition bg-white ${
					selected
						? "border-accent ring-4 ring-accent/30 shadow-[0_8px_24px_rgba(16,185,129,0.18)]"
						: onWs
							? "border-accent/40 ring-2 ring-accent/20 shadow-[0_8px_24px_rgba(16,185,129,0.12)]"
							: "border-black/5 hover:border-black/10 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
				}`}
				style={{ aspectRatio: `1 / ${aspect}` }}
			>
				<img
					src={thumbSrc}
					alt={doc.name}
					loading="lazy"
					className="absolute inset-0 w-full h-full object-cover"
					style={{ background: "#fff" }}
					draggable={false}
				/>
				{selected && (
					<span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md bg-accent text-white flex items-center justify-center text-2xs font-bold">
						✓
					</span>
				)}
				{locked && (
					<span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-md bg-black/60 text-white flex items-center justify-center">
						<Lock size={10} />
					</span>
				)}
				<span className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
					{(doc.rating ?? 0) > 0 && (
						<span className="px-1.5 py-0.5 rounded-md bg-amber-100/95 text-amber-600 text-2xs font-bold backdrop-blur">
							★{doc.rating}
						</span>
					)}
					{onWs && (
						<span className="w-5 h-5 rounded-md bg-accent text-white flex items-center justify-center text-2xs font-bold">
							✓
						</span>
					)}
				</span>
			</button>

			{/* Caption */}
			{editing ? (
				<div className="mt-1">
					<InlineNameEditor
						initial={mode.kind === "rename" ? doc.name : `${doc.name} copy`}
						placeholder={
							mode.kind === "rename"
								? t("doc_rename_prompt")
								: t("doc_duplicate_prompt")
						}
						onCommit={(value) => {
							const trimmed = value.trim();
							onModeChange({ kind: "idle" });
							if (!trimmed) return;
							if (mode.kind === "rename") {
								if (trimmed === doc.name) return;
								sendRenameDoc(doc.name, trimmed);
							} else {
								sendDuplicateDoc(doc.name, trimmed);
							}
						}}
						onCancel={() => onModeChange({ kind: "idle" })}
					/>
				</div>
			) : confirming ? (
				<div className="mt-1">
					<HoldToDelete
						label={t("doc_delete_hold", { name: doc.name })}
						onConfirm={() => {
							onModeChange({ kind: "idle" });
							sendDeleteDoc(doc.name);
						}}
						onCancel={() => onModeChange({ kind: "idle" })}
					/>
				</div>
			) : (
				<div className="mt-1 px-1 flex items-center gap-1.5">
					{doc.charteColor && (
						<span
							className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/5"
							style={{ background: doc.charteColor }}
							title={doc.charte || ""}
						/>
					)}
					<div className="flex-1 min-w-0">
						<div
							className={`text-xs truncate ${onWs ? "font-bold text-accent" : "font-semibold text-text-1"}`}
						>
							{doc.name}
						</div>
						<div className="flex items-center gap-1 text-2xs text-text-3">
							<span className="font-bold">{doc.format}</span>
							<span>{doc.pageCount ?? 1}p</span>
							{(doc.rating ?? 0) > 0 && (
								<span className="text-amber-500">★{doc.rating}</span>
							)}
						</div>
					</div>
					<button
						type="button"
						aria-label={t("doc_menu")}
						onClick={(e) => {
							e.stopPropagation();
							if (menuOpen) onMenuClose();
							else onMenuOpen();
						}}
						className={`w-6 h-6 rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.06] transition ${
							menuOpen
								? "bg-black/[0.06]"
								: "opacity-0 group-hover/card:opacity-100 focus:opacity-100"
						}`}
					>
						<MoreVertical size={13} />
					</button>
				</div>
			)}

			{menuOpen && (
				<DocMenu
					doc={doc}
					onClose={onMenuClose}
					canDelete={canDelete}
					locked={locked}
					onRename={() => {
						onMenuClose();
						onModeChange({ kind: "rename" });
					}}
					onDuplicate={() => {
						onMenuClose();
						onModeChange({ kind: "duplicate" });
					}}
					onDeleteRequest={() => {
						onMenuClose();
						onModeChange({ kind: "confirm-delete" });
					}}
				/>
			)}
		</div>
	);
}

function DocRow({
	doc,
	onWs,
	selected,
	onClick,
	menuOpen,
	onMenuOpen,
	onMenuClose,
	mode,
	onModeChange,
	canDelete,
	dragging,
	onDragStart,
	onDragEnd,
}: DocRowProps) {
	const t = useT();
	const locked = doc.locked === true;
	const editing = mode.kind === "rename" || mode.kind === "duplicate";
	const dragEnabled = mode.kind === "idle";

	return (
		<div
			className={`relative group ${dragging ? "opacity-40" : ""}`}
			draggable={dragEnabled}
			onDragStart={(e) => {
				if (!dragEnabled) {
					e.preventDefault();
					return;
				}
				onDragStart(e);
			}}
			onDragEnd={onDragEnd}
		>
			{editing ? (
				<InlineNameEditor
					initial={mode.kind === "rename" ? doc.name : `${doc.name} copy`}
					placeholder={
						mode.kind === "rename"
							? t("doc_rename_prompt")
							: t("doc_duplicate_prompt")
					}
					onCommit={(value) => {
						const trimmed = value.trim();
						onModeChange({ kind: "idle" });
						if (!trimmed) return;
						if (mode.kind === "rename") {
							if (trimmed === doc.name) return;
							sendRenameDoc(doc.name, trimmed);
						} else {
							sendDuplicateDoc(doc.name, trimmed);
						}
					}}
					onCancel={() => onModeChange({ kind: "idle" })}
				/>
			) : (
				<button
					type="button"
					onClick={onClick}
					className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
						selected
							? "bg-accent/10 ring-2 ring-accent/30"
							: onWs
								? "bg-accent/5"
								: "hover:bg-black/[0.03]"
					}`}
				>
					<div
						className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
							onWs ? "bg-accent/10" : "bg-input"
						}`}
					>
						<FileText
							size={14}
							className={onWs ? "text-accent" : "text-text-3"}
						/>
					</div>
					<div className="flex-1 min-w-0">
						<div
							className={`text-base truncate flex items-center gap-1.5 ${onWs ? "font-bold text-accent" : "font-medium text-text-1"}`}
						>
							{locked && (
								<Lock
									size={11}
									className="text-text-3 flex-shrink-0"
									aria-label={t("doc_locked")}
								/>
							)}
							{doc.charteColor && (
								<span
									className="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-black/5"
									style={{ background: doc.charteColor }}
									title={doc.charte || ""}
								/>
							)}
							<span className="truncate">{doc.name}</span>
						</div>
						<div className="flex items-center gap-1.5 mt-0.5 text-2xs text-text-3">
							<span className="font-bold">{doc.format}</span>
							<span>{doc.pageCount ?? 1}p</span>
							{(doc.rating ?? 0) > 0 && (
								<span
									className="flex items-center gap-0.5 text-amber-500"
									title={`rating ${doc.rating}`}
								>
									<span className="leading-none">★</span>
									<span className="tabular-nums">{doc.rating}</span>
								</span>
							)}
							{doc.updatedAt && (
								<span
									className="ml-auto text-text-3/80 tabular-nums"
									title={doc.updatedAt}
								>
									{relativeTime(doc.updatedAt, navigator.language)}
								</span>
							)}
						</div>
					</div>
					{onWs && !menuOpen && mode.kind !== "confirm-delete" && (
						<span className="text-2xs font-bold text-accent mr-6">✓</span>
					)}
				</button>
			)}

			{mode.kind === "confirm-delete" && (
				<HoldToDelete
					label={t("doc_delete_hold", { name: doc.name })}
					onConfirm={() => {
						onModeChange({ kind: "idle" });
						sendDeleteDoc(doc.name);
					}}
					onCancel={() => onModeChange({ kind: "idle" })}
				/>
			)}

			{!editing && mode.kind !== "confirm-delete" && (
				<button
					type="button"
					aria-label={t("doc_menu")}
					onClick={(e) => {
						e.stopPropagation();
						if (menuOpen) onMenuClose();
						else onMenuOpen();
					}}
					className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.06] transition ${
						menuOpen
							? "bg-black/[0.06]"
							: "opacity-0 group-hover:opacity-100 focus:opacity-100"
					}`}
				>
					<MoreVertical size={14} />
				</button>
			)}

			{menuOpen && (
				<DocMenu
					doc={doc}
					onClose={onMenuClose}
					canDelete={canDelete}
					locked={locked}
					onRename={() => {
						onMenuClose();
						onModeChange({ kind: "rename" });
					}}
					onDuplicate={() => {
						onMenuClose();
						onModeChange({ kind: "duplicate" });
					}}
					onDeleteRequest={() => {
						onMenuClose();
						onModeChange({ kind: "confirm-delete" });
					}}
				/>
			)}
		</div>
	);
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
		// Select the base name without the trailing " copy" so the user can
		// type straight over the default while keeping the suffix visible.
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

interface HoldToDeleteProps {
	label: string;
	onConfirm: () => void;
	onCancel: () => void;
}

function HoldToDelete({ label, onConfirm, onCancel }: HoldToDeleteProps) {
	const HOLD_MS = 650;
	const [progress, setProgress] = useState(0);
	const rafRef = useRef<number | null>(null);
	const startRef = useRef<number | null>(null);
	const firedRef = useRef(false);

	const stop = () => {
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		startRef.current = null;
	};

	const tick = (now: number) => {
		if (startRef.current == null) startRef.current = now;
		const p = Math.min(1, (now - startRef.current) / HOLD_MS);
		setProgress(p);
		if (p >= 1) {
			if (!firedRef.current) {
				firedRef.current = true;
				stop();
				onConfirm();
			}
			return;
		}
		rafRef.current = requestAnimationFrame(tick);
	};

	const begin = (e: React.PointerEvent) => {
		if (firedRef.current) return;
		e.preventDefault();
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		rafRef.current = requestAnimationFrame(tick);
	};

	const end = () => {
		if (firedRef.current) return;
		stop();
		setProgress(0);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			stop();
		};
	}, [onCancel]);

	return (
		<div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-danger-soft text-danger">
			<button
				type="button"
				onPointerDown={begin}
				onPointerUp={end}
				onPointerLeave={end}
				onPointerCancel={end}
				className="relative flex-1 min-w-0 flex items-center gap-2.5 py-1 select-none text-left focus:outline-none"
			>
				<div
					className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-danger/15"
					style={{ transform: `scale(${1 + progress * 0.08})` }}
				>
					<Trash2 size={13} />
				</div>
				<span className="relative flex-1 truncate text-sm font-semibold">
					{label}
				</span>
				<div
					className="absolute inset-x-0 bottom-0 h-0.5 bg-danger rounded-full origin-left"
					style={{ transform: `scaleX(${progress})` }}
				/>
			</button>
			<button
				type="button"
				onClick={onCancel}
				aria-label="cancel"
				className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-danger/15 text-danger"
			>
				<span aria-hidden className="text-base leading-none">
					×
				</span>
			</button>
		</div>
	);
}

interface DocMenuProps {
	doc: DocSummary;
	onClose: () => void;
	canDelete: boolean;
	locked: boolean;
	onRename: () => void;
	onDuplicate: () => void;
	onDeleteRequest: () => void;
}

function DocMenu({
	doc,
	onClose,
	canDelete,
	locked,
	onRename,
	onDuplicate,
	onDeleteRequest,
}: DocMenuProps) {
	const t = useT();
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [onClose]);

	const handleCopy = async () => {
		await copyToClipboard(doc.name);
		onClose();
	};

	const handleLock = () => {
		sendLockDoc(doc.name, !locked);
		onClose();
	};

	return (
		<div
			ref={ref}
			className="absolute right-1.5 top-[calc(100%-4px)] z-50 w-48 bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] overflow-hidden py-1"
		>
			<MenuItem icon={<Copy size={13} />} onClick={handleCopy}>
				{t("doc_copy_name")}
			</MenuItem>
			<MenuItem
				icon={<Pencil size={13} />}
				onClick={onRename}
				disabled={locked}
			>
				{t("doc_rename")}
			</MenuItem>
			<MenuItem icon={<Files size={13} />} onClick={onDuplicate}>
				{t("doc_duplicate")}
			</MenuItem>
			<MenuItem
				icon={locked ? <Unlock size={13} /> : <Lock size={13} />}
				onClick={handleLock}
			>
				{locked ? t("doc_unlock") : t("doc_lock")}
			</MenuItem>
			<div className="h-px bg-black/[0.06] my-1" />
			<MenuItem
				icon={<Trash2 size={13} />}
				onClick={onDeleteRequest}
				disabled={locked || !canDelete}
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
