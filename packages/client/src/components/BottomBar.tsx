import {
	ChevronDown,
	ChevronUp,
	FileText,
	Image,
	Lock,
	LockOpen,
	Maximize,
	MessageCircle,
	Moon,
	Palette,
	Printer,
	Sun,
	Table,
} from "lucide-react";
import { getLang, toggleLang, useT } from "../i18n/useT";
import { useFocusedDoc, useStore } from "../store/useStore";
import { fitToView } from "../store/zoomBridge";

type PanelName = "chartes" | "photos" | "docs" | "collections" | "exchange";

// code-moniker: ignore[smell-feature-envy-local]
// BottomBar is the client shell adapter: it intentionally composes store selectors, i18n, and command controls without owning their state.
export function BottomBar() {
	const t = useT();
	const connected = useStore((s) => s.connected);
	const focusedDoc = useFocusedDoc();
	const pendingCount = useStore((s) => s.pending.length);
	const activePanel = useStore((s) => s.activePanel);
	const togglePanel = useStore((s) => s.togglePanel);
	const position = useStore((s) => s.barPosition);
	const setBarPosition = useStore((s) => s.setBarPosition);
	const darkMode = useStore((s) => s.darkMode);
	const autoFocusFit = useStore((s) => s.autoFocusFit);
	const toggleAutoFocusFit = useStore((s) => s.toggleAutoFocusFit);

	const hasDoc = focusedDoc !== null;
	const togglePosition = () =>
		setBarPosition(position === "bottom" ? "top" : "bottom");

	return (
		<div
			className={`fixed left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-0.5 ${position === "bottom" ? "bottom-1" : "top-1"}`}
		>
			{position === "top" && (
				<PositionToggle direction="bottom" onToggle={togglePosition} />
			)}

			<div className="flex items-center h-11 bg-panel rounded-full shadow-lg px-1.5 select-none gap-1">
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
				<PanelButton
					panel="docs"
					icon={<FileText size={16} />}
					title={t("documents")}
					activePanel={activePanel}
					onToggle={togglePanel}
				/>
				<PanelButton
					panel="collections"
					icon={<Table size={16} />}
					title={t("collections")}
					activePanel={activePanel}
					onToggle={togglePanel}
				/>

				<FitControls
					autoFocusFit={autoFocusFit}
					onToggleAutoFocusFit={toggleAutoFocusFit}
					fitLabel={t("fit")}
					autoOnLabel={t("auto_focus_fit_on")}
					autoOffLabel={t("auto_focus_fit_off")}
				/>

				<div className="flex items-center gap-1.5 px-2">
					<div
						className={`w-2 h-2 rounded-full transition-colors ${connected ? "bg-accent" : "bg-danger animate-pulse"}`}
					/>
					<span className="text-base font-semibold text-text-1 max-w-[200px] truncate">
						{focusedDoc?.name ?? t("no_document")}
					</span>
				</div>

				<PanelButton
					panel="exchange"
					icon={<MessageCircle size={16} />}
					title={t("exchanges")}
					badge={pendingCount}
					activePanel={activePanel}
					onToggle={togglePanel}
				/>

				{hasDoc && (
					<a
						href={`/print?name=${encodeURIComponent(focusedDoc?.name || "")}`}
						target="_blank"
						rel="noopener"
						title={t("print")}
						aria-label={t("print")}
						className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors no-underline"
					>
						<Printer size={16} />
					</a>
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

			{position === "bottom" && (
				<PositionToggle direction="top" onToggle={togglePosition} />
			)}
		</div>
	);
}

function PanelButton({
	panel,
	icon,
	title,
	activePanel,
	onToggle,
	badge,
}: {
	panel: PanelName;
	icon: React.ReactNode;
	title: string;
	activePanel: string | null;
	onToggle: (panel: PanelName) => void;
	badge?: number;
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
		</button>
	);
}

function FitControls({
	autoFocusFit,
	onToggleAutoFocusFit,
	fitLabel,
	autoOnLabel,
	autoOffLabel,
}: {
	autoFocusFit: boolean;
	onToggleAutoFocusFit: () => void;
	fitLabel: string;
	autoOnLabel: string;
	autoOffLabel: string;
}) {
	const autoLabel = autoFocusFit ? autoOnLabel : autoOffLabel;
	return (
		<>
			<button
				type="button"
				onClick={fitToView}
				title={fitLabel}
				aria-label={fitLabel}
				className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors"
			>
				<Maximize size={16} />
			</button>
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
