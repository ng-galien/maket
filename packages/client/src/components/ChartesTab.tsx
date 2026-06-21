import {
	type CharteRulesWire,
	type ChartesListItem,
	parseCharteRules,
} from "@maket/shared";
import {
	ArrowLeft,
	Check,
	Copy,
	LayoutGrid,
	List,
	MoreVertical,
	Pencil,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { copyToClipboard } from "../utils";
import { CharteEditModal } from "./CharteEditModal";

/** Shared envelope (`{ name }`) plus the fields this panel actually renders. */
interface Charte extends ChartesListItem {
	description?: string;
	tokens?: Record<string, Record<string, string>>;
	voice?: {
		personality?: string[];
		formality?: string;
		do?: string[];
		dont?: string[];
	};
	rules?: CharteRulesWire;
}

function parseVoice(voice: any): any {
	if (!voice) return null;
	if (typeof voice === "string") {
		try {
			return JSON.parse(voice);
		} catch {
			return null;
		}
	}
	return voice;
}

const VIEW_KEY = "maket-chartes-view";
type View = "list" | "grid";

function tokenCount(c: Charte): number {
	if (!c.tokens) return 0;
	let n = 0;
	for (const bucket of Object.values(c.tokens))
		n += Object.keys(bucket || {}).length;
	return n;
}

function colorsOf(c: Charte): [string, string][] {
	return c.tokens?.color ? Object.entries(c.tokens.color) : [];
}

function displayFontOf(c: Charte): string | null {
	const f = c.tokens?.font;
	if (!f) return null;
	return f.heading || f.display || f.title || Object.values(f)[0] || null;
}

export function ChartesTab() {
	const model = useChartesTabModel();
	if (model.preview) {
		return (
			<>
				<ChartePreviewInline
					charte={model.preview}
					onBack={() => model.setPreview(null)}
					onEdit={() => model.setEditing(model.preview)}
					barPosition={model.barPosition}
				/>
				{model.editModal}
			</>
		);
	}
	return <ChartesTabView model={model} />;
}

function useChartesTabModel() {
	const t = useT();
	const [chartes, setChartes] = useState<Charte[]>([]);
	const [preview, setPreview] = useState<Charte | null>(null);
	const [editing, setEditing] = useState<Charte | null>(null);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState("");
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [view, setView] = useState<View>(() => {
		const stored = localStorage.getItem(VIEW_KEY);
		return stored === "grid" ? "grid" : "list";
	});
	const hasDoc = useStore((s) => s.focusedDocName !== null);
	const focusedDocName = useStore((s) => s.focusedDocName);
	const currentCharte = useStore((s) => {
		const doc = s.focusedDocName ? s.docs.get(s.focusedDocName) : null;
		return doc?.meta?.charte as string | undefined;
	});
	const barPosition = useStore((s) => s.barPosition);
	const chartesVersion = useStore((s) => s.chartesVersion);

	useEffect(() => {
		fetch("/api/chartes")
			.then((r) => r.json())
			.then((data) => {
				setChartes(data);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	}, [chartesVersion]);

	const setViewAndPersist = (v: View) => {
		setView(v);
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {}
	};

	const applyCharte = (name: string) => {
		if (!focusedDocName) return;
		wsSend({ type: "update_meta", docName: focusedDocName, charte: name });
	};
	const unapplyCharte = () => {
		if (!focusedDocName) return;
		wsSend({ type: "update_meta", docName: focusedDocName, charte: "" });
	};

	useEffect(() => {
		if (!chartes.length) return;
		if (preview) {
			const next = chartes.find((c) => c.name === preview.name);
			if (next && next !== preview) setPreview(next);
		}
		if (editing) {
			const next = chartes.find((c) => c.name === editing.name);
			if (next && next !== editing) setEditing(next);
		}
	}, [chartes, preview, editing]);

	const editModal = editing ? (
		<CharteEditModal charte={editing} onClose={() => setEditing(null)} />
	) : null;

	const q = search.trim().toLowerCase();
	const filtered = q
		? chartes.filter((c) => {
				if (c.name.toLowerCase().includes(q)) return true;
				if (c.description?.toLowerCase().includes(q)) return true;
				const voice = parseVoice(c.voice);
				if (
					voice?.personality?.some((p: string) => p.toLowerCase().includes(q))
				)
					return true;
				return false;
			})
		: chartes;

	const activeCharte =
		currentCharte && filtered.find((c) => c.name === currentCharte);
	const restCharte = filtered.filter((c) => c.name !== currentCharte);
	const charteItemFor = (
		charte: Charte,
		isActive: boolean,
	): CharteItemProps => ({
		model: { charte, isActive, hasDoc },
		actions: {
			open: () => setPreview(charte),
			edit: () => setEditing(charte),
			apply: () => applyCharte(charte.name),
			unapply: unapplyCharte,
			openMenu: () => setMenuFor(charte.name),
			closeMenu: () => setMenuFor(null),
		},
		menuOpen: menuFor === charte.name,
	});

	return {
		t,
		chartes,
		preview,
		setPreview,
		editing,
		setEditing,
		loading,
		search,
		setSearch,
		view,
		setViewAndPersist,
		barPosition,
		activeCharte,
		restCharte,
		filtered,
		charteItemFor,
		editModal,
	};
}

function ChartesTabView({
	model,
}: {
	model: ReturnType<typeof useChartesTabModel>;
}) {
	const {
		t,
		chartes,
		loading,
		search,
		setSearch,
		view,
		setViewAndPersist,
		barPosition,
		activeCharte,
		restCharte,
		filtered,
		charteItemFor,
		editModal,
	} = model;
	return (
		<>
			<div
				className={`flex ${barPosition === "bottom" ? "flex-col-reverse" : "flex-col"} gap-2 p-3`}
			>
				<div className="px-1 flex items-center gap-1.5">
					<div className="relative flex-1 min-w-0">
						<Search
							size={13}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none"
						/>
						<input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder={t("charte_search_hint")}
							className="w-full pl-8 pr-8 py-2 bg-input rounded-lg text-base outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
						/>
						{search && (
							<button
								type="button"
								onClick={() => setSearch("")}
								aria-label="Clear"
								className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-black/[0.06] transition"
							>
								<X size={12} />
							</button>
						)}
					</div>
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

				{loading ? (
					<div className="text-center text-text-3 text-xs py-6">
						{t("loading")}
					</div>
				) : chartes.length === 0 ? (
					<EmptyState />
				) : filtered.length === 0 ? (
					<div className="px-4 py-6 text-center text-base text-text-3">
						{t("charte_no_match")}
					</div>
				) : (
					<>
						{activeCharte && (
							<section className="flex flex-col gap-1.5">
								<div className="flex items-center gap-2 px-1">
									<span
										className="w-1.5 h-1.5 rounded-full bg-accent"
										aria-hidden
									/>
									<span className="text-2xs font-bold uppercase tracking-wider text-accent">
										{t("charte_active_section")}
									</span>
								</div>
								{view === "grid" ? (
									<CharteCard {...charteItemFor(activeCharte, true)} />
								) : (
									<CharteRow {...charteItemFor(activeCharte, true)} />
								)}
								<div className="h-px bg-black/[0.06] my-1" />
							</section>
						)}
						{view === "grid" ? (
							<div className="grid grid-cols-1 gap-2">
								{restCharte.map((c) => (
									<CharteCard key={c.name} {...charteItemFor(c, false)} />
								))}
							</div>
						) : (
							<div className="flex flex-col gap-1">
								{restCharte.map((c) => (
									<CharteRow key={c.name} {...charteItemFor(c, false)} />
								))}
							</div>
						)}
					</>
				)}
			</div>
			{editModal}
		</>
	);
}

function EmptyState() {
	const t = useT();
	return (
		<div className="mx-2 py-8 px-4 rounded-xl border-2 border-dashed border-border bg-input/40 text-center">
			<div className="w-10 h-10 mx-auto rounded-full bg-accent-soft flex items-center justify-center mb-3">
				<Sparkles size={18} className="text-accent" />
			</div>
			<div className="text-sm font-bold text-text-1 mb-1">{t("no_charte")}</div>
			<div className="text-xs text-text-3 leading-relaxed">
				{t("no_charte_cta")}
			</div>
		</div>
	);
}

interface CharteItemModel {
	charte: Charte;
	isActive: boolean;
	hasDoc: boolean;
}

interface CharteItemActions {
	open: () => void;
	edit: () => void;
	apply: () => void;
	unapply: () => void;
	openMenu: () => void;
	closeMenu: () => void;
}

interface CharteItemProps {
	model: CharteItemModel;
	actions: CharteItemActions;
	menuOpen: boolean;
}

function CharteRow({ model, actions, menuOpen }: CharteItemProps) {
	const { charte, isActive, hasDoc } = model;
	const t = useT();
	const colors = colorsOf(charte);
	const font = displayFontOf(charte);
	const menuBtnRef = useRef<HTMLButtonElement>(null);
	const count = tokenCount(charte);

	return (
		<div className="relative group">
			<button
				type="button"
				onClick={actions.open}
				className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${
					isActive
						? "bg-accent/10 ring-2 ring-accent/30"
						: "bg-panel hover:bg-black/[0.03]"
				}`}
			>
				<div
					className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-black/5 overflow-hidden relative"
					style={{
						background: colors.length ? colors[0]?.[1] : "#f4f4f4",
					}}
				>
					<span
						className="text-base font-black"
						style={{
							fontFamily: font || undefined,
							color: isReadableOnDark(colors[0]?.[1]) ? "#fff" : "#111",
							textShadow: "0 1px 2px rgba(0,0,0,0.2)",
						}}
					>
						Aa
					</span>
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5">
						{isActive && (
							<Check size={11} className="text-accent flex-shrink-0" />
						)}
						<span
							className={`truncate text-base ${isActive ? "font-bold text-accent" : "font-semibold text-text-1"}`}
						>
							{charte.name}
						</span>
					</div>
					<div className="flex items-center gap-1.5 mt-0.5 text-2xs text-text-3">
						<span className="tabular-nums font-bold">{count}</span>
						<span>{t("charte_tokens_label")}</span>
						{colors.length > 0 && (
							<>
								<span className="text-text-3/40">·</span>
								<span className="flex gap-0.5">
									{colors.slice(0, 5).map(([k, v]) => (
										<span
											key={k}
											className="w-2 h-2 rounded-full ring-1 ring-black/5"
											style={{ background: v }}
										/>
									))}
									{colors.length > 5 && (
										<span className="ml-0.5 tabular-nums">
											+{colors.length - 5}
										</span>
									)}
								</span>
							</>
						)}
					</div>
				</div>
				{hasDoc && !isActive && (
					<span
						onClick={(e) => {
							e.stopPropagation();
							actions.apply();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								e.preventDefault();
								actions.apply();
							}
						}}
						role="button"
						tabIndex={0}
						className="mr-6 px-2.5 py-1 rounded-md text-xs font-semibold bg-accent text-white hover:brightness-110 transition cursor-pointer"
					>
						{t("apply")}
					</span>
				)}
			</button>
			<button
				ref={menuBtnRef}
				type="button"
				aria-label={t("charte_menu")}
				onClick={(e) => {
					e.stopPropagation();
					if (menuOpen) actions.closeMenu();
					else actions.openMenu();
				}}
				className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.06] transition ${
					menuOpen
						? "bg-black/[0.06]"
						: "opacity-0 group-hover:opacity-100 focus:opacity-100"
				}`}
			>
				<MoreVertical size={14} />
			</button>
			{menuOpen && (
				<CharteMenu model={model} actions={actions} anchorRef={menuBtnRef} />
			)}
		</div>
	);
}

function CharteCard({ model, actions, menuOpen }: CharteItemProps) {
	const { charte, isActive, hasDoc } = model;
	const t = useT();
	const colors = colorsOf(charte);
	const font = displayFontOf(charte);
	const menuBtnRef = useRef<HTMLButtonElement>(null);
	const count = tokenCount(charte);
	const primary = colors[0]?.[1] ?? "#111";
	const textLight = isReadableOnDark(primary);

	return (
		<div className="relative group/card">
			<button
				type="button"
				onClick={actions.open}
				className={`w-full rounded-xl overflow-hidden border text-left transition ${
					isActive
						? "border-accent ring-4 ring-accent/20 shadow-[0_8px_24px_rgba(16,185,129,0.15)]"
						: "border-black/5 hover:border-black/10 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] bg-panel"
				}`}
			>
				<div
					className="h-24 flex items-center justify-center relative"
					style={{ background: primary }}
				>
					<span
						className="text-4xl font-black leading-none"
						style={{
							fontFamily: font || undefined,
							color: textLight ? "#fff" : "#111",
							textShadow: textLight
								? "0 2px 12px rgba(0,0,0,0.25)"
								: "0 2px 12px rgba(255,255,255,0.25)",
						}}
					>
						Aa
					</span>
					{isActive && (
						<span className="absolute top-2 right-2 w-5 h-5 rounded-md bg-accent text-white flex items-center justify-center">
							<Check size={11} />
						</span>
					)}
				</div>

				{colors.length > 0 && (
					<div className="flex h-3">
						{colors.slice(0, 8).map(([k, v]) => (
							<span key={k} className="flex-1" style={{ background: v }} />
						))}
					</div>
				)}

				<div className="p-3 flex items-start gap-2">
					<div className="flex-1 min-w-0">
						<div
							className={`truncate text-base ${isActive ? "font-bold text-accent" : "font-bold text-text-1"}`}
						>
							{charte.name}
						</div>
						{charte.description ? (
							<div className="text-2xs text-text-3 truncate mt-0.5">
								{charte.description}
							</div>
						) : (
							<div className="text-2xs text-text-3 mt-0.5">
								<span className="tabular-nums font-bold">{count}</span>{" "}
								{t("charte_tokens_label")}
							</div>
						)}
					</div>
					{hasDoc && !isActive && (
						<span
							onClick={(e) => {
								e.stopPropagation();
								actions.apply();
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									e.preventDefault();
									actions.apply();
								}
							}}
							role="button"
							tabIndex={0}
							className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold bg-accent text-white hover:brightness-110 transition cursor-pointer"
						>
							{t("apply")}
						</span>
					)}
				</div>
			</button>

			<button
				ref={menuBtnRef}
				type="button"
				aria-label={t("charte_menu")}
				onClick={(e) => {
					e.stopPropagation();
					if (menuOpen) actions.closeMenu();
					else actions.openMenu();
				}}
				className={`absolute top-1.5 left-1.5 w-7 h-7 rounded-md flex items-center justify-center transition backdrop-blur-sm ${
					menuOpen
						? "bg-black/40 text-white"
						: "bg-black/20 text-white/90 hover:bg-black/40 opacity-0 group-hover/card:opacity-100"
				}`}
			>
				<MoreVertical size={14} />
			</button>
			{menuOpen && (
				<CharteMenu model={model} actions={actions} anchorRef={menuBtnRef} />
			)}
		</div>
	);
}

interface CharteMenuProps {
	model: CharteItemModel;
	actions: CharteItemActions;
	anchorRef: React.RefObject<HTMLElement | null>;
}

function CharteMenu({ model, actions, anchorRef }: CharteMenuProps) {
	const { charte, isActive, hasDoc } = model;
	const t = useT();
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

	useLayoutEffect(() => {
		const a = anchorRef.current;
		if (!a) return;
		const rect = a.getBoundingClientRect();
		const MENU_W = 200;
		const GAP = 4;
		const top = rect.bottom + GAP;
		const left = Math.max(
			8,
			Math.min(rect.left, window.innerWidth - MENU_W - 8),
		);
		setPos({ top, left });
	}, [anchorRef]);

	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			if (anchorRef.current?.contains(e.target as Node)) return;
			actions.closeMenu();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") actions.closeMenu();
		};
		const onScroll = () => actions.closeMenu();
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

	if (!pos) return null;

	const handleCopyName = async () => {
		await copyToClipboard(charte.name);
		actions.closeMenu();
	};

	return createPortal(
		<div
			ref={ref}
			className="fixed z-[210] w-50 bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 overflow-hidden py-1"
			style={{ top: pos.top, left: pos.left, width: 200 }}
		>
			<MenuItem
				icon={<Search size={13} />}
				onClick={() => {
					actions.open();
					actions.closeMenu();
				}}
			>
				{t("charte_details")}
			</MenuItem>
			<MenuItem
				icon={<Pencil size={13} />}
				onClick={() => {
					actions.edit();
					actions.closeMenu();
				}}
			>
				{t("charte_edit")}
			</MenuItem>
			{hasDoc && !isActive && (
				<MenuItem
					icon={<Check size={13} />}
					onClick={() => {
						actions.apply();
						actions.closeMenu();
					}}
				>
					{t("apply")}
				</MenuItem>
			)}
			{hasDoc && isActive && (
				<MenuItem
					icon={<X size={13} />}
					onClick={() => {
						actions.unapply();
						actions.closeMenu();
					}}
				>
					{t("charte_unapply")}
				</MenuItem>
			)}
			<MenuItem icon={<Copy size={13} />} onClick={handleCopyName}>
				{t("charte_copy_name")}
			</MenuItem>
		</div>,
		document.body,
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

/** Best-effort brightness check for "is this colour dark enough to warrant white text". */
function isReadableOnDark(color: string | undefined): boolean {
	if (!color) return false;
	const hex = color.trim().replace(/^#/, "");
	if (hex.length !== 3 && hex.length !== 6) return false;
	const h =
		hex.length === 3
			? hex
					.split("")
					.map((c) => c + c)
					.join("")
			: hex;
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	if ([r, g, b].some((n) => Number.isNaN(n))) return false;
	const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	return luma < 0.55;
}

function ChartePreviewInline({
	charte,
	onBack,
	onEdit,
	barPosition,
}: {
	charte: Charte;
	onBack: () => void;
	onEdit: () => void;
	barPosition: "top" | "bottom";
}) {
	const colors = charte.tokens?.color
		? Object.entries(charte.tokens.color)
		: [];
	const fonts = charte.tokens?.font ? Object.entries(charte.tokens.font) : [];
	const spacing = charte.tokens?.spacing
		? Object.entries(charte.tokens.spacing)
		: [];
	const voice = parseVoice(charte.voice);
	const rules = parseCharteRules(charte.rules);

	return (
		<div
			className={`flex ${barPosition === "bottom" ? "flex-col-reverse" : "flex-col"} p-3 gap-4`}
		>
			<ChartePreviewHeader charte={charte} onBack={onBack} onEdit={onEdit} />
			<CharteColorsSection colors={colors} />
			<CharteFontsSection fonts={fonts} />
			<CharteSpacingSection spacing={spacing} />
			<CharteVoiceSection voice={voice} />
			<CharteRulesSection rules={rules} />
		</div>
	);
}

function ChartePreviewHeader({
	charte,
	onBack,
	onEdit,
}: {
	charte: Charte;
	onBack: () => void;
	onEdit: () => void;
}) {
	const t = useT();
	return (
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={onBack}
				className="p-1.5 rounded-lg text-text-3 hover:text-text-1 hover:bg-input transition"
			>
				<ArrowLeft size={16} />
			</button>
			<div className="flex-1 min-w-0">
				<div className="text-md font-bold truncate">{charte.name}</div>
				{charte.description && (
					<div className="text-xs text-text-3 truncate">
						{charte.description}
					</div>
				)}
			</div>
			<button
				type="button"
				onClick={onEdit}
				className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-text-2 hover:text-text-1 hover:bg-input transition"
			>
				<Pencil size={13} />
				{t("charte_edit")}
			</button>
		</div>
	);
}

function CharteColorsSection({ colors }: { colors: [string, string][] }) {
	if (colors.length === 0) return null;
	return (
		<section>
			<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
				Couleurs
			</h3>
			<div className="flex flex-wrap gap-2">
				{colors.map(([name, value]) => (
					<div
						key={name}
						className="flex items-center gap-2 bg-input rounded-lg px-2.5 py-1.5"
					>
						<div
							className="w-5 h-5 rounded-full border border-border/50"
							style={{ background: value }}
						/>
						<div>
							<div className="text-xs font-semibold">{name}</div>
							<div className="text-2xs text-text-3 font-mono">{value}</div>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

function CharteFontsSection({ fonts }: { fonts: [string, string][] }) {
	const t = useT();
	if (fonts.length === 0) return null;
	return (
		<section>
			<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
				{t("fonts")}
			</h3>
			<div className="flex flex-col gap-1">
				{fonts.map(([role, family]) => (
					<div key={role} className="flex items-baseline gap-2">
						<span className="text-xs text-text-3 min-w-[60px]">{role}</span>
						<span
							className="text-base font-medium"
							style={{ fontFamily: family }}
						>
							{family.split(",")[0].replace(/'/g, "")}
						</span>
					</div>
				))}
			</div>
		</section>
	);
}

function CharteSpacingSection({ spacing }: { spacing: [string, string][] }) {
	if (spacing.length === 0) return null;
	return (
		<section>
			<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
				Espacements
			</h3>
			<div className="flex flex-wrap gap-2">
				{spacing.map(([name, value]) => (
					<span
						key={name}
						className="text-xs font-medium px-2.5 py-1 rounded-full bg-input text-text-2"
					>
						{name}: {value}
					</span>
				))}
			</div>
		</section>
	);
}

function CharteVoiceSection({ voice }: { voice: any }) {
	const t = useT();
	if (!voice) return null;
	return (
		<section>
			<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
				{t("voice_tone")}
			</h3>
			{voice.personality && (
				<div className="flex flex-wrap gap-1.5 mb-2">
					{voice.personality.map((p: string) => (
						<span
							key={p}
							className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-soft text-accent"
						>
							{p}
						</span>
					))}
				</div>
			)}
			{voice.formality && (
				<div className="text-sm text-text-2 mb-2">
					{t("voice_formality")} : {voice.formality}
				</div>
			)}
			<VoiceList title={t("voice_do")} items={voice.do} kind="do" />
			<VoiceList title={t("voice_dont")} items={voice.dont} kind="dont" />
		</section>
	);
}

function VoiceList({
	title,
	items,
	kind,
}: {
	title: string;
	items?: string[];
	kind: "do" | "dont";
}) {
	if (!items) return null;
	return (
		<div className="mb-2">
			<div
				className={`text-2xs font-bold mb-1 ${
					kind === "do" ? "text-green-600" : "text-danger"
				}`}
			>
				{title}
			</div>
			{items.map((item) => (
				<div key={item} className="text-xs text-text-2 pl-3">
					• {item}
				</div>
			))}
		</div>
	);
}

function CharteRulesSection({ rules }: { rules: Record<string, string> }) {
	const t = useT();
	if (Object.keys(rules).length === 0) return null;
	return (
		<section>
			<h3 className="text-xs font-bold text-text-3 uppercase tracking-wider mb-2">
				{t("rules")}
			</h3>
			{Object.entries(rules).map(([key, val]) => (
				<div key={key} className="mb-2">
					<div className="text-xs font-bold text-text-2 capitalize">{key}</div>
					<div className="text-xs text-text-3">{val}</div>
				</div>
			))}
		</section>
	);
}
