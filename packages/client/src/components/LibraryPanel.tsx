import {
	Database,
	Files,
	HelpCircle,
	Image,
	LoaderCircle,
	MessageCircle,
	Palette,
	PanelLeft,
	PanelLeftDashed,
	Settings as SettingsIcon,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	configurationNoticeRequired,
	useDesktopConfiguration,
} from "../desktopConfiguration";
import { useDesktopUpdates } from "../desktopUpdates";
import { getLang, useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { ChartesTab } from "./ChartesTab";
import { CollectionsTab } from "./CollectionsTab";
import { DocsTab } from "./DocsTab";
import { MessagesPanel } from "./MessagesPanel";
import { PhotosTab } from "./PhotosTab";
import { ResizeHandleFeedback } from "./shared/ResizeHandleFeedback";
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
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function LibraryPanel() {
	const t = useT();
	const open = useStore((state) => state.libraryOpen);
	const view = useStore((state) => state.libraryView);
	const pinned = useStore((state) => state.libraryPinned);
	const setView = useStore((state) => state.setLibraryView);
	const toggleLibrary = useStore((state) => state.toggleLibrary);
	const toggleLibraryPinned = useStore((state) => state.toggleLibraryPinned);
	const settingsOpen = useStore((state) => state.settingsOpen);
	const toggleSettings = useStore((state) => state.toggleSettings);
	const closeSettings = useStore((state) => state.closeSettings);
	const pendingCount = useStore((state) => state.pending.length);
	const update = useDesktopUpdates();
	const configuration = useDesktopConfiguration();
	const [width, setWidth] = useState(() => loadPanelWidth("library"));
	const preferredWidth = useRef(width);
	const panelRef = useRef<HTMLElement>(null);
	const resizePanel = useCallback((next: number) => {
		preferredWidth.current = next;
		setWidth(next);
	}, []);
	useEffect(() => {
		const reclamp = () => setWidth(clampPanelWidth(preferredWidth.current));
		reclamp();
		window.addEventListener("resize", reclamp);
		return () => window.removeEventListener("resize", reclamp);
	}, []);

	const options: LibraryOption[] = [
		{
			value: "docs",
			label: t("documents"),
			icon: <Files size={21} strokeWidth={1.65} />,
		},
		{
			value: "photos",
			label: t("photos"),
			icon: <Image size={21} strokeWidth={1.65} />,
		},
		{
			value: "collections",
			label: t("collections"),
			icon: <Database size={21} strokeWidth={1.65} />,
		},
		{
			value: "chartes",
			label: t("chartes"),
			icon: <Palette size={21} strokeWidth={1.65} />,
		},
		{
			value: "exchange",
			label: t("exchanges"),
			icon: <MessageCircle size={21} strokeWidth={1.65} />,
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
					: "w-14"
			}`}
		>
			<NavigationRail
				library={{ options, view, open, pinned, setView, toggleLibrary }}
				settings={{
					open: settingsOpen,
					toggle: toggleSettings,
					close: closeSettings,
				}}
				update={update}
				configuration={configuration}
			/>
			{open && (
				<ExtendedLibrary
					view={view}
					pinned={pinned}
					width={width}
					setWidth={resizePanel}
					panelRef={panelRef}
					onTogglePinned={toggleLibraryPinned}
				/>
			)}
		</aside>
	);
}

function NavigationRail({
	library,
	settings,
	update,
	configuration,
}: {
	library: {
		options: LibraryOption[];
		view: LibraryView;
		open: boolean;
		pinned: boolean;
		setView: (view: LibraryView) => void;
		toggleLibrary: () => void;
	};
	settings: { open: boolean; toggle: () => void; close: () => void };
	update: ReturnType<typeof useDesktopUpdates>;
	configuration: ReturnType<typeof useDesktopConfiguration>;
}) {
	const t = useT();
	return (
		<div className="flex w-14 shrink-0 flex-col border-r border-border bg-panel">
			<nav
				aria-label={t("libraries")}
				className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden py-2"
			>
				{library.options.map((option) => {
					const active = library.open && option.value === library.view;
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
										if (library.open && option.value === library.view) {
											if (!library.pinned) library.toggleLibrary();
											return;
										}
										library.setView(option.value);
									}}
									aria-label={option.label}
									aria-current={active ? "page" : undefined}
									aria-expanded={active}
									className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-[background-color,color,box-shadow] duration-150 ${
										active
											? "bg-accent-soft text-accent shadow-xs"
											: "text-text-2 hover:bg-input hover:text-text-1"
									}`}
								>
									<span
										data-library-rail-icon
										aria-hidden="true"
										className={`flex transition-transform duration-150 ${active ? "scale-105" : "scale-100"}`}
									>
										{option.icon}
									</span>
									{option.badge != null && option.badge > 0 && (
										<span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-contrast ring-2 ring-panel">
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
				settingsOpen={settings.open}
				toggleSettings={settings.toggle}
				closeSettings={settings.close}
				update={update}
				configuration={configuration}
			/>
		</div>
	);
}

function ExtendedLibrary({
	view,
	pinned,
	width,
	setWidth,
	panelRef,
	onTogglePinned,
}: {
	view: LibraryView;
	pinned: boolean;
	width: number;
	setWidth: (width: number) => void;
	panelRef: React.RefObject<HTMLElement | null>;
	onTogglePinned: () => void;
}) {
	return (
		<div
			data-library-pinned={pinned || undefined}
			className="relative flex min-w-0 flex-1 flex-col"
		>
			<LibraryPinToggle pinned={pinned} onToggle={onTogglePinned} />
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
		</div>
	);
}

function LibraryPinToggle({
	pinned,
	onToggle,
}: {
	pinned: boolean;
	onToggle: () => void;
}) {
	const t = useT();
	const pinLabel = pinned ? t("unpin_navigation") : t("pin_navigation");
	return (
		<button
			type="button"
			data-library-pin
			onClick={onToggle}
			aria-label={pinLabel}
			aria-pressed={pinned}
			title={pinLabel}
			className={`absolute -right-8 top-0 z-[calc(var(--z-bar)+2)] flex h-[49px] w-8 items-center justify-center rounded-br-md border border-l-0 border-t-0 border-border bg-panel transition-colors ${
				pinned
					? "bg-accent-soft text-accent"
					: "text-text-3 hover:bg-input hover:text-text-1"
			}`}
		>
			{pinned && (
				<span
					data-library-pin-state
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-2 left-0 w-0.5 bg-accent"
				/>
			)}
			{pinned ? (
				<PanelLeft size={17} strokeWidth={1.7} />
			) : (
				<PanelLeftDashed size={17} strokeWidth={1.7} />
			)}
		</button>
	);
}

function NavigationUtilities({
	settingsOpen,
	toggleSettings,
	closeSettings,
	update,
	configuration,
}: {
	settingsOpen: boolean;
	toggleSettings: () => void;
	closeSettings: () => void;
	update: ReturnType<typeof useDesktopUpdates>;
	configuration: ReturnType<typeof useDesktopConfiguration>;
}) {
	const t = useT();
	return (
		<div className="flex shrink-0 flex-col items-center gap-1 border-t border-border py-2">
			<NavigationUtilityButton
				label={t("help")}
				onClick={() => {
					closeSettings();
					wsSend({ type: "open_onboarding", lang: getLang() });
				}}
			>
				<HelpCircle size={21} strokeWidth={1.65} />
			</NavigationUtilityButton>
			<div className="relative">
				<NavigationUtilityButton
					label={<UpdateRailTooltip update={update} />}
					ariaLabel={t("settings")}
					active={settingsOpen}
					onClick={toggleSettings}
					badge={
						<SettingsRailBadge
							update={update}
							configurationRequired={configurationNoticeRequired(
								configuration.plan,
							)}
						/>
					}
				>
					<SettingsIcon size={21} strokeWidth={1.65} />
				</NavigationUtilityButton>
			</div>
		</div>
	);
}

function NavigationUtilityButton({
	label,
	ariaLabel,
	onClick,
	active = false,
	badge,
	children,
}: {
	label: ReactNode;
	ariaLabel?: string;
	onClick: () => void;
	active?: boolean;
	badge?: ReactNode;
	children: ReactNode;
}) {
	return (
		<RailTooltip label={label}>
			<button
				type="button"
				onClick={onClick}
				aria-label={
					ariaLabel ?? (typeof label === "string" ? label : undefined)
				}
				aria-current={active ? "page" : undefined}
				className={`relative flex h-11 w-11 items-center justify-center rounded-lg transition-[background-color,color,box-shadow] duration-150 ${active ? "bg-accent-soft text-accent shadow-xs" : "text-text-2 hover:bg-input hover:text-text-1"}`}
			>
				<span
					aria-hidden="true"
					className={`flex transition-transform duration-150 ${active ? "scale-105" : "scale-100"}`}
				>
					{children}
				</span>
				{badge}
			</button>
		</RailTooltip>
	);
}

function RailTooltip({
	label,
	children,
}: {
	label: ReactNode;
	children: ReactNode;
}) {
	const anchorRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{
		left: number;
		top: number;
	} | null>(null);
	const show = () => {
		const bounds = anchorRef.current?.getBoundingClientRect();
		if (!bounds) return;
		setPosition({
			left: bounds.right + 8,
			top: bounds.top + bounds.height / 2,
		});
	};
	return (
		<div
			ref={anchorRef}
			className="relative flex w-11 shrink-0 justify-center"
			onMouseEnter={show}
			onMouseLeave={() => setPosition(null)}
			onFocus={show}
			onBlur={() => setPosition(null)}
		>
			{children}
			{position &&
				createPortal(
					<div
						role="tooltip"
						style={{ left: position.left, top: position.top }}
						className="pointer-events-none fixed z-[var(--z-popover)] -translate-y-1/2 whitespace-nowrap rounded-sm bg-text-1 px-2 py-1 text-xs font-semibold text-panel shadow-md"
					>
						{label}
					</div>,
					document.body,
				)}
		</div>
	);
}

function SettingsRailBadge({
	update,
	configurationRequired,
}: {
	update: ReturnType<typeof useDesktopUpdates>;
	configurationRequired: boolean;
}) {
	if (update.status === "checking" || update.status === "downloading") {
		return (
			<span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-panel text-accent ring-1 ring-border">
				<LoaderCircle size={10} className="animate-spin" />
			</span>
		);
	}
	if (
		update.status !== "ready" &&
		update.status !== "error" &&
		!configurationRequired
	)
		return null;
	return (
		<span
			aria-hidden="true"
			className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-panel ${update.status === "error" ? "bg-danger" : "bg-accent"}`}
		/>
	);
}

function UpdateRailTooltip({
	update,
}: {
	update: ReturnType<typeof useDesktopUpdates>;
}) {
	const t = useT();
	const active =
		update.status === "checking" || update.status === "downloading";
	const version = update.currentVersion
		? ` · v${update.currentVersion}${update.version ? ` → v${update.version}` : ""}`
		: "";
	const reason = update.reason
		? ` · ${t(`settings_update_reason_${update.reason}`)}`
		: "";
	return (
		<div className="min-w-40 py-0.5">
			<div>{t("settings")}</div>
			<div className="mt-0.5 font-normal opacity-75">
				{t(`settings_update_status_${update.status}`)}
				{version}
				{reason}
			</div>
			{active && (
				<div className="mt-1.5 h-px overflow-hidden bg-panel/30">
					<span className="block h-full w-2/3 animate-pulse bg-panel" />
				</div>
			)}
		</div>
	);
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
	const [resizing, setResizing] = useState(false);
	const t = useT();
	useEffect(() => () => cancelResizeRef.current?.(), []);

	const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = panelRef.current?.getBoundingClientRect().width ?? width;
		setResizing(true);
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
			setResizing(false);
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
			data-resizing={resizing || undefined}
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
			<ResizeHandleFeedback orientation="vertical" active={resizing} />
		</div>
	);
}
