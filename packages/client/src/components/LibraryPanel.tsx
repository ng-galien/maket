import {
	ChevronLeft,
	Database,
	FileText,
	HelpCircle,
	Image,
	MessageCircle,
	Palette,
	Settings as SettingsIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getLang, useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { ChartesTab } from "./ChartesTab";
import { CollectionsTab } from "./CollectionsTab";
import { DocsTab } from "./DocsTab";
import { MessagesPanel } from "./MessagesPanel";
import { PhotosTab } from "./PhotosTab";
import {
	clampPanelWidth,
	loadPanelWidth,
	savePanelWidth,
} from "./sidePanelResize";

type LibraryView = "docs" | "chartes" | "photos" | "collections" | "exchange";

interface LibraryOption {
	value: LibraryView;
	label: string;
	icon: React.ReactNode;
	badge?: number;
}

/** One persistent library pane replaces the four competing overlay panels. */
// This shell adapter intentionally composes the existing domain panels and store selectors.
// code-moniker: ignore[smell-feature-envy-local]
export function LibraryPanel() {
	const t = useT();
	const open = useStore((state) => state.libraryOpen);
	const view = useStore((state) => state.libraryView);
	const setView = useStore((state) => state.setLibraryView);
	const toggleLibrary = useStore((state) => state.toggleLibrary);
	const settingsOpen = useStore((state) => state.settingsOpen);
	const toggleSettings = useStore((state) => state.toggleSettings);
	const closeSettings = useStore((state) => state.closeSettings);
	const pendingCount = useStore((state) => state.pending.length);
	const [width, setWidth] = useState(() => loadPanelWidth("library"));
	const panelRef = useRef<HTMLElement>(null);

	const options: LibraryOption[] = [
		{ value: "docs", label: t("documents"), icon: <FileText size={18} /> },
		{ value: "chartes", label: t("chartes"), icon: <Palette size={18} /> },
		{ value: "photos", label: t("photos"), icon: <Image size={18} /> },
		{
			value: "collections",
			label: t("collections"),
			icon: <Database size={18} />,
		},
		{
			value: "exchange",
			label: t("exchanges"),
			icon: <MessageCircle size={18} />,
			badge: pendingCount,
		},
	];
	const selected =
		options.find((option) => option.value === view) ?? options[0];

	return (
		<aside
			ref={panelRef}
			data-library-panel
			data-library-mode={open ? "extended" : "compact"}
			data-library-view={view}
			aria-label={open ? selected.label : t("libraries")}
			style={open ? { width } : undefined}
			className={`relative z-[var(--z-bar)] flex h-full shrink-0 flex-row border-r border-border bg-panel transition-[transform,width] duration-200 data-[resizing=true]:transition-none ${
				open
					? "max-[959px]:absolute max-[959px]:inset-y-0 max-[959px]:left-0 max-[959px]:max-w-[calc(100vw-3rem)] max-[959px]:shadow-xl"
					: "w-13"
			}`}
		>
			<NavigationRail
				options={options}
				view={view}
				open={open}
				setView={setView}
				toggleLibrary={toggleLibrary}
				settingsOpen={settingsOpen}
				toggleSettings={toggleSettings}
				closeSettings={closeSettings}
			/>
			{open && (
				<ExtendedLibrary
					view={view}
					width={width}
					setWidth={setWidth}
					panelRef={panelRef}
					onClose={toggleLibrary}
				/>
			)}
		</aside>
	);
}

function NavigationRail({
	options,
	view,
	open,
	setView,
	toggleLibrary,
	settingsOpen,
	toggleSettings,
	closeSettings,
}: {
	options: LibraryOption[];
	view: LibraryView;
	open: boolean;
	setView: (view: LibraryView) => void;
	toggleLibrary: () => void;
	settingsOpen: boolean;
	toggleSettings: () => void;
	closeSettings: () => void;
}) {
	const t = useT();
	return (
		<div className="flex w-13 shrink-0 flex-col border-r border-border bg-panel">
			<nav
				aria-label={t("libraries")}
				className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-2"
			>
				{options.map((option) => {
					const active = open && option.value === view;
					return (
						<div key={option.value} className="contents">
							{option.value === "exchange" && (
								<span aria-hidden="true" className="my-1 h-px w-6 bg-border" />
							)}
							<RailTooltip label={option.label}>
								<button
									type="button"
									data-library-rail-view={option.value}
									onClick={() => {
										if (open && option.value === view) toggleLibrary();
										else setView(option.value);
									}}
									aria-label={option.label}
									aria-current={active ? "page" : undefined}
									aria-expanded={active}
									className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-100 ${
										active
											? "bg-accent-soft text-accent"
											: "text-text-2 hover:bg-input hover:text-text-1"
									}`}
								>
									{option.icon}
									{option.badge != null && option.badge > 0 && (
										<span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white ring-2 ring-panel">
											{option.badge}
										</span>
									)}
								</button>
							</RailTooltip>
						</div>
					);
				})}
			</nav>
			<NavigationUtilities
				settingsOpen={settingsOpen}
				toggleSettings={toggleSettings}
				closeSettings={closeSettings}
			/>
		</div>
	);
}

function ExtendedLibrary({
	view,
	width,
	setWidth,
	panelRef,
	onClose,
}: {
	view: LibraryView;
	width: number;
	setWidth: (width: number) => void;
	panelRef: React.RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	return (
		<div className="relative flex min-w-0 flex-1 flex-col">
			<div
				data-library-content
				className="min-h-0 flex-1 overflow-hidden bg-panel"
			>
				{view === "docs" && <DocsTab />}
				{view === "chartes" && <ChartesTab />}
				{view === "photos" && <PhotosTab />}
				{view === "collections" && <CollectionsTab />}
				{view === "exchange" && <MessagesPanel />}
			</div>
			<PanelResizeHandle
				panel="library"
				width={width}
				setWidth={setWidth}
				panelRef={panelRef}
			/>
			<PanelCollapseButton onClick={onClose} />
		</div>
	);
}

function PanelCollapseButton({ onClick }: { onClick: () => void }) {
	const t = useT();
	return (
		<button
			type="button"
			data-library-edge-close
			onClick={onClick}
			aria-label={t("collapse_navigation")}
			title={t("collapse_navigation")}
			className="absolute top-1/2 -right-8 z-20 flex h-10 w-7 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-accent bg-panel text-accent shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
		>
			<ChevronLeft size={16} strokeWidth={2} />
		</button>
	);
}

function NavigationUtilities({
	settingsOpen,
	toggleSettings,
	closeSettings,
}: {
	settingsOpen: boolean;
	toggleSettings: () => void;
	closeSettings: () => void;
}) {
	const t = useT();
	return (
		<div className="flex shrink-0 flex-col items-center gap-1 border-t border-border py-2">
			<NavigationUtilityButton
				label={t("help")}
				onClick={() => {
					closeSettings();
					wsSend({ type: "open_onboarding", lang: helpLang() });
				}}
			>
				<HelpCircle size={18} />
			</NavigationUtilityButton>
			<NavigationUtilityButton
				label={t("settings")}
				active={settingsOpen}
				onClick={toggleSettings}
			>
				<SettingsIcon size={18} />
			</NavigationUtilityButton>
		</div>
	);
}

function NavigationUtilityButton({
	label,
	onClick,
	active = false,
	children,
}: {
	label: string;
	onClick: () => void;
	active?: boolean;
	children: React.ReactNode;
}) {
	return (
		<RailTooltip label={label}>
			<button
				type="button"
				onClick={onClick}
				aria-label={label}
				aria-current={active ? "page" : undefined}
				className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${active ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-input hover:text-text-1"}`}
			>
				{children}
			</button>
		</RailTooltip>
	);
}

function RailTooltip({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="group/rail-tooltip relative flex w-10 shrink-0 justify-center">
			{children}
			<span
				role="tooltip"
				className="pointer-events-none invisible absolute left-[calc(100%+8px)] top-1/2 z-[var(--z-popover)] -translate-y-1/2 whitespace-nowrap rounded-sm bg-text-1 px-2 py-1 text-xs font-semibold text-panel opacity-0 shadow-md transition-opacity group-hover/rail-tooltip:visible group-hover/rail-tooltip:opacity-100 group-focus-within/rail-tooltip:visible group-focus-within/rail-tooltip:opacity-100"
			>
				{label}
			</span>
		</div>
	);
}

function helpLang(): "en" | "fr" {
	return getLang() === "fr" ? "fr" : "en";
}

function PanelResizeHandle({
	panel,
	width,
	setWidth,
	panelRef,
}: {
	panel: "library";
	width: number;
	setWidth: (width: number) => void;
	panelRef: React.RefObject<HTMLElement | null>;
}) {
	const cancelResizeRef = useRef<(() => void) | null>(null);
	const t = useT();
	useEffect(() => () => cancelResizeRef.current?.(), []);

	const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = panelRef.current?.getBoundingClientRect().width ?? width;
		panelRef.current?.setAttribute("data-resizing", "true");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		const move = (moveEvent: PointerEvent) =>
			setWidth(clampPanelWidth(startWidth + moveEvent.clientX - startX));
		const stop = () => {
			savePanelWidth(
				panel,
				panelRef.current?.getBoundingClientRect().width ?? width,
			);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			panelRef.current?.removeAttribute("data-resizing");
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
			window.removeEventListener("blur", stop);
			cancelResizeRef.current = null;
		};
		cancelResizeRef.current?.();
		cancelResizeRef.current = stop;
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
		window.addEventListener("blur", stop);
	};

	return (
		<div
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-label={t("resize_library_panel")}
			aria-valuemin={320}
			aria-valuemax={Math.min(760, window.innerWidth - 16)}
			aria-valuenow={Math.round(width)}
			onPointerDown={startResize}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const delta = event.key === "ArrowRight" ? 16 : -16;
				const next = clampPanelWidth(width + delta);
				setWidth(next);
				savePanelWidth(panel, next);
			}}
			className="group/resize absolute inset-y-3 -right-1.5 z-10 flex w-3 cursor-col-resize items-center justify-center focus-visible:outline-none"
		>
			<span className="h-9 w-0.5 rounded-full bg-text-3/60 transition-[height,background-color] group-hover/resize:h-14 group-hover/resize:bg-text-3 group-focus/resize:h-14 group-focus/resize:bg-text-3" />
		</div>
	);
}
