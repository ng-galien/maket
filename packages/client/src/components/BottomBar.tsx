import {
	ChevronDown,
	ChevronUp,
	FileText,
	Image,
	MessageCircle,
	Moon,
	Palette,
	Sun,
} from "lucide-react";
import { useT } from "../i18n/useT";
import { useFocusedDoc, useStore } from "../store/useStore";

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

	const togglePosition = () => {
		setBarPosition(position === "bottom" ? "top" : "bottom");
	};

	const hasDoc = focusedDoc !== null;

	const iconBtn = (
		panel: "chartes" | "photos" | "docs" | "exchange",
		icon: React.ReactNode,
		title: string,
		badge?: number,
	) => (
		<button
			type="button"
			onClick={() => togglePanel(panel)}
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

	return (
		<div
			className={`fixed left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-0.5 ${position === "bottom" ? "bottom-1" : "top-1"}`}
		>
			{/* Toggle — above bar when at top */}
			{position === "top" && (
				<button
					type="button"
					onClick={togglePosition}
					title="Move to bottom"
					className="w-5 h-4 rounded-full flex items-center justify-center text-text-1 bg-panel shadow-sm hover:shadow-md transition-shadow"
				>
					<ChevronDown size={12} />
				</button>
			)}

			{/* The pill */}
			<div className="flex items-center h-11 bg-panel rounded-full shadow-lg px-1.5 select-none gap-1">
				{iconBtn("chartes", <Palette size={16} />, t("chartes"))}
				{iconBtn("photos", <Image size={16} />, t("photos"))}
				{iconBtn("docs", <FileText size={16} />, t("documents"))}

				{/* ● Doc name */}
				<div className="flex items-center gap-1.5 px-2">
					<div
						className={`w-2 h-2 rounded-full transition-colors ${connected ? "bg-accent" : "bg-danger animate-pulse"}`}
					/>
					<span className="text-[13px] font-semibold text-text-1 max-w-[200px] truncate">
						{focusedDoc?.name ?? t("no_document")}
					</span>
				</div>

				{iconBtn(
					"exchange",
					<MessageCircle size={16} />,
					t("exchanges"),
					pendingCount,
				)}

				{/* PDF */}
				{hasDoc && (
					<a
						href={`/print?name=${encodeURIComponent(focusedDoc?.name || "")}`}
						target="_blank"
						rel="noopener"
						className="text-xs font-semibold px-3 py-1.5 rounded-full text-text-3 hover:text-text-1 hover:bg-input transition-colors"
					>
						PDF
					</a>
				)}

				{/* Dark mode toggle */}
				<button
					type="button"
					onClick={() => useStore.getState().toggleDarkMode()}
					title={darkMode ? "Light mode" : "Dark mode"}
					className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-input transition-colors"
				>
					{darkMode ? <Sun size={16} /> : <Moon size={16} />}
				</button>
			</div>

			{/* Toggle — below bar when at bottom */}
			{position === "bottom" && (
				<button
					type="button"
					onClick={togglePosition}
					title="Move to top"
					className="w-5 h-4 rounded-full flex items-center justify-center text-text-1 bg-panel shadow-sm hover:shadow-md transition-shadow"
				>
					<ChevronUp size={12} />
				</button>
			)}
		</div>
	);
}
