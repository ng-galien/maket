import {
	BookOpen,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	FileText,
	HelpCircle,
	History,
	Image,
	LayoutGrid,
	Lock,
	LockOpen,
	Maximize,
	MessageCircle,
	Moon,
	Palette,
	Pencil,
	Printer,
	Sun,
	Table,
} from "lucide-react";
import { getLang, toggleLang, useT } from "../i18n/useT";
import type { Document } from "../store/types";
import { useFocusedDoc, useStore } from "../store/useStore";
import { clearActivityBubbles, wsSend } from "../store/ws";
import { fitToView } from "../store/zoomBridge";
import { DataSourceToolbarControl } from "./DataSourceToolbarControl";
import { returnToCanvas, scrollToReadingPage } from "./ReadingWorkspace";

type PanelName = "chartes" | "photos" | "docs" | "collections" | "exchange";

export function BottomBar() {
	const position = useStore((s) => s.barPosition);
	const setBarPosition = useStore((s) => s.setBarPosition);
	const togglePosition = () =>
		setBarPosition(position === "bottom" ? "top" : "bottom");

	return (
		<div
			className={`fixed left-1/2 -translate-x-1/2 z-[var(--z-bar)] flex flex-col items-center gap-0.5 ${position === "bottom" ? "bottom-1" : "top-1"}`}
		>
			{position === "top" && (
				<PositionToggle direction="bottom" onToggle={togglePosition} />
			)}

			<BottomBarControls />

			{position === "bottom" && (
				<PositionToggle direction="top" onToggle={togglePosition} />
			)}
		</div>
	);
}

// code-moniker: ignore[smell-feature-envy-local]
// BottomBarControls is the client shell adapter: it intentionally composes store selectors, i18n, and command controls without owning their state.
function BottomBarControls() {
	const t = useT();
	const connected = useStore((s) => s.connected);
	const focusedDoc = useFocusedDoc();
	const pendingCount = useStore((s) => s.pending.length);
	const activePanel = useStore((s) => s.activePanel);
	const togglePanel = useStore((s) => s.togglePanel);
	const darkMode = useStore((s) => s.darkMode);
	const autoFocusFit = useStore((s) => s.autoFocusFit);
	const toggleAutoFocusFit = useStore((s) => s.toggleAutoFocusFit);
	const workspaceView = useStore((s) => s.workspaceView);
	const setWorkspaceView = useStore((s) => s.setWorkspaceView);
	const focusedPageIndex = useStore((s) => s.focusedPageIndex);
	const setFocusedPage = useStore((s) => s.setFocusedPage);
	const toggleWorkspaceView = () => {
		if (!focusedDoc) return;
		if (workspaceView === "reading") {
			returnToCanvas(focusedDoc.name, focusedPageIndex, setWorkspaceView);
			return;
		}
		useStore.getState().setActivePanel(null);
		useStore.getState().setFocusedCollection(null);
		clearActivityBubbles();
		setWorkspaceView("reading");
	};
	const showLogicalPage = (pageIndex: number) => {
		if (!focusedDoc) return;
		setFocusedPage(focusedDoc.name, pageIndex);
		requestAnimationFrame(() =>
			scrollToReadingPage(focusedDoc.name, pageIndex, "smooth"),
		);
	};

	return (
		<div
			data-toolbar-shell
			className="flex max-w-[calc(100vw-0.5rem)] items-center gap-1 overflow-x-auto rounded-full bg-panel px-1.5 h-11 shadow-lg select-none"
		>
			<PanelLaunchers compact={workspaceView === "reading"} />
			{focusedDoc && (
				<WorkspaceViewToggle
					reading={workspaceView === "reading"}
					canvasLabel={t("canvas_view")}
					readingLabel={t("reading_view")}
					onToggle={toggleWorkspaceView}
				/>
			)}
			<FitControls
				reading={workspaceView === "reading"}
				autoFocusFit={autoFocusFit}
				onToggleAutoFocusFit={toggleAutoFocusFit}
				onFit={
					workspaceView === "reading" && focusedDoc
						? () => showLogicalPage(focusedPageIndex)
						: fitToView
				}
				fitLabel={
					workspaceView === "reading" ? t("fit_reading_page") : t("fit")
				}
				autoOnLabel={t("auto_focus_fit_on")}
				autoOffLabel={t("auto_focus_fit_off")}
			/>
			{workspaceView === "reading" && focusedDoc && (
				<ReadingPageControls
					pageIndex={focusedPageIndex}
					pageTotal={focusedDoc.pages.length}
					previousLabel={t("previous_page")}
					nextLabel={t("next_page")}
					onChange={showLogicalPage}
				/>
			)}
			<div className="flex items-center gap-1.5 px-2 max-md:hidden">
				<div
					className={`w-2 h-2 rounded-full transition-colors ${connected ? "bg-accent" : "bg-danger animate-pulse"}`}
				/>
				<span className="text-base font-semibold text-text-1 max-w-[200px] truncate">
					{focusedDoc?.name ?? t("no_document")}
				</span>
			</div>
			<div
				className={`items-center gap-1 ${workspaceView === "reading" ? "hidden md:flex" : "flex"}`}
			>
				<DataSourceToolbarControl />
				<StateDocumentIndicator doc={focusedDoc} />
			</div>
			<PanelButton
				panel="exchange"
				icon={<MessageCircle size={16} />}
				title={t("exchanges")}
				badge={pendingCount}
				activePanel={activePanel}
				onToggle={togglePanel}
			/>
			<div
				className={`items-center gap-1 ${workspaceView === "reading" ? "hidden sm:flex" : "flex"}`}
			>
				<HelpButton label={t("help")} />
				{focusedDoc && (
					<PrintLink href={printHrefForDoc(focusedDoc)} label={t("print")} />
				)}
				<button
					type="button"
					onClick={toggleLang}
					title={
						getLang() === "fr" ? "Switch to English" : "Passer en français"
					}
					aria-label="Language"
					className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors text-[10px] font-bold tracking-wide uppercase"
				>
					{getLang() === "fr" ? "FR" : "EN"}
				</button>
				<button
					type="button"
					onClick={() => useStore.getState().toggleDarkMode()}
					title={darkMode ? "Light mode" : "Dark mode"}
					className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors"
				>
					{darkMode ? <Sun size={16} /> : <Moon size={16} />}
				</button>
			</div>
		</div>
	);
}

function PanelLaunchers({ compact }: { compact: boolean }) {
	const t = useT();
	const activePanel = useStore((s) => s.activePanel);
	const togglePanel = useStore((s) => s.togglePanel);
	const dataViewOpen = useStore((s) => s.focusedCollectionName !== null);
	return (
		<>
			<div
				className={`items-center gap-1 ${compact ? "hidden sm:flex" : "flex"}`}
			>
				<PanelButton
					panel="chartes"
					icon={<Palette size={16} />}
					title={t("chartes")}
					activePanel={activePanel}
					onToggle={togglePanel}
				/>
				<PanelButton
					panel="photos"
					icon={<Image size={16} />}
					title={t("photos")}
					activePanel={activePanel}
					onToggle={togglePanel}
				/>
			</div>
			<PanelButton
				panel="docs"
				icon={<FileText size={16} />}
				title={t("documents")}
				activePanel={activePanel}
				onToggle={togglePanel}
			/>
			<div className={compact ? "hidden sm:block" : "block"}>
				<PanelButton
					panel="collections"
					icon={<Table size={16} />}
					title={t("collections")}
					activePanel={activePanel}
					onToggle={togglePanel}
					dot={dataViewOpen}
				/>
			</div>
		</>
	);
}

function WorkspaceViewToggle({
	reading,
	canvasLabel,
	readingLabel,
	onToggle,
}: {
	reading: boolean;
	canvasLabel: string;
	readingLabel: string;
	onToggle: () => void;
}) {
	const actionLabel = reading ? canvasLabel : readingLabel;
	return (
		<button
			type="button"
			onClick={onToggle}
			title={actionLabel}
			aria-label={readingLabel}
			aria-pressed={reading}
			className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
				reading
					? "bg-accent-soft text-accent"
					: "text-text-3 hover:text-text-1 hover:bg-input"
			}`}
		>
			{reading ? <LayoutGrid size={16} /> : <BookOpen size={16} />}
		</button>
	);
}

function ReadingPageControls({
	pageIndex,
	pageTotal,
	previousLabel,
	nextLabel,
	onChange,
}: {
	pageIndex: number;
	pageTotal: number;
	previousLabel: string;
	nextLabel: string;
	onChange: (pageIndex: number) => void;
}) {
	return (
		<div
			className="flex h-9 items-center rounded-full bg-input px-0.5"
			role="group"
		>
			<button
				type="button"
				disabled={pageIndex <= 0}
				onClick={() => onChange(pageIndex - 1)}
				title={previousLabel}
				aria-label={previousLabel}
				className="flex h-8 w-7 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-panel hover:text-text-1 disabled:opacity-30"
			>
				<ChevronLeft size={15} />
			</button>
			<span className="min-w-11 px-1 text-center text-xs font-semibold tabular-nums text-text-2">
				{pageIndex + 1}/{pageTotal}
			</span>
			<button
				type="button"
				disabled={pageIndex >= pageTotal - 1}
				onClick={() => onChange(pageIndex + 1)}
				title={nextLabel}
				aria-label={nextLabel}
				className="flex h-8 w-7 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-panel hover:text-text-1 disabled:opacity-30"
			>
				<ChevronRight size={15} />
			</button>
		</div>
	);
}

function StateDocumentIndicator({ doc }: { doc: Document | null }) {
	const t = useT();
	const docName = doc?.dataModel === "state" ? doc.name : null;
	const mode = useStore((s) =>
		docName ? (s.stateCanvasModes[docName] ?? "live") : "live",
	);
	const setMode = useStore((s) => s.setStateCanvasMode);
	if (!docName) return null;
	return (
		<div
			role="group"
			aria-label={t("state_document_mode")}
			className="flex h-9 items-center rounded-full bg-input p-0.5"
		>
			<StateModeButton
				active={mode === "live"}
				label={t("state_live_mode")}
				onClick={() => setMode(docName, "live")}
			>
				<History size={14} />
			</StateModeButton>
			<StateModeButton
				active={mode === "design"}
				label={t("state_design_mode")}
				onClick={() => setMode(docName, "design")}
			>
				<Pencil size={13} />
			</StateModeButton>
		</div>
	);
}

function StateModeButton({
	active,
	label,
	onClick,
	children,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			aria-label={label}
			title={label}
			onClick={onClick}
			className={`flex h-8 items-center gap-1 rounded-full px-2 text-[10px] font-bold transition-colors ${
				active
					? "bg-panel text-accent shadow-sm"
					: "text-text-3 hover:text-text-1"
			}`}
		>
			{children}
			<span className="max-lg:hidden">{label}</span>
		</button>
	);
}

function HelpButton({ label }: { label: string }) {
	return (
		<button
			type="button"
			onClick={() => wsSend({ type: "open_onboarding", lang: helpLang() })}
			title={label}
			aria-label={label}
			className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors"
		>
			<HelpCircle size={16} />
		</button>
	);
}

function helpLang(): "en" | "fr" {
	return getLang() === "fr" ? "fr" : "en";
}

function PrintLink({ href, label }: { href: string; label: string }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener"
			title={label}
			aria-label={label}
			className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors no-underline"
		>
			<Printer size={16} />
		</a>
	);
}

/** The server owns the page↔collection cursors and `/print` follows them by
 * default — the client only names the document. */
export function printHrefForDoc(doc: Document): string {
	return `/print?${new URLSearchParams({ name: doc.name }).toString()}`;
}

function PanelButton({
	panel,
	icon,
	title,
	activePanel,
	onToggle,
	badge,
	dot = false,
}: {
	panel: PanelName;
	icon: React.ReactNode;
	title: string;
	activePanel: string | null;
	onToggle: (panel: PanelName) => void;
	badge?: number;
	/** Small state dot (e.g. the data view is open) — same language as the
	 * data-source trigger's binding dot. */
	dot?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={() => onToggle(panel)}
			title={title}
			className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors relative ${
				activePanel === panel
					? "bg-accent text-white"
					: "text-text-3 hover:text-text-1 hover:bg-input"
			}`}
		>
			{icon}
			{badge != null && badge > 0 && (
				<span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center">
					{badge}
				</span>
			)}
			{dot && (badge == null || badge === 0) && (
				<span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-accent ring-2 ring-panel" />
			)}
		</button>
	);
}

function FitControls({
	reading,
	autoFocusFit,
	onToggleAutoFocusFit,
	onFit,
	fitLabel,
	autoOnLabel,
	autoOffLabel,
}: {
	reading: boolean;
	autoFocusFit: boolean;
	onToggleAutoFocusFit: () => void;
	onFit: () => void;
	fitLabel: string;
	autoOnLabel: string;
	autoOffLabel: string;
}) {
	const autoLabel = autoFocusFit ? autoOnLabel : autoOffLabel;
	return (
		<>
			<button
				type="button"
				onClick={onFit}
				title={fitLabel}
				aria-label={fitLabel}
				className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors"
			>
				<Maximize size={16} />
			</button>
			{!reading && (
				<button
					type="button"
					onClick={onToggleAutoFocusFit}
					title={autoLabel}
					aria-label={autoLabel}
					aria-pressed={!autoFocusFit}
					className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
						autoFocusFit
							? "text-text-3 hover:text-text-1 hover:bg-input"
							: "text-accent hover:bg-input"
					}`}
				>
					{autoFocusFit ? <LockOpen size={16} /> : <Lock size={16} />}
				</button>
			)}
		</>
	);
}

function PositionToggle({
	direction,
	onToggle,
}: {
	direction: "top" | "bottom";
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			title={direction === "top" ? "Move to top" : "Move to bottom"}
			className="w-5 h-4 rounded-full flex items-center justify-center text-text-1 bg-panel shadow-sm hover:shadow-md transition-shadow"
		>
			{direction === "top" ? (
				<ChevronUp size={12} />
			) : (
				<ChevronDown size={12} />
			)}
		</button>
	);
}
