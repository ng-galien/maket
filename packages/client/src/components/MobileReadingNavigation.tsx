import {
	Files,
	Image,
	MessageCircle,
	PanelsTopLeft,
	Settings,
} from "lucide-react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";

/** Mobile has destinations for reading, rather than authoring tool docks. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// This shell adapter composes existing library and settings navigation commands.
export function MobileReadingNavigation() {
	const t = useT();
	const view = useStore((state) => state.libraryView);
	const open = useStore((state) => state.libraryOpen);
	const settings = useStore((state) => state.settingsOpen);
	const setView = useStore((state) => state.setLibraryView);
	const close = useStore((state) => state.closeLastPanel);
	const toggleSettings = useStore((state) => state.toggleSettings);
	return (
		<nav
			data-mobile-reading-navigation
			aria-label={t("libraries")}
			className="flex shrink-0 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)]"
		>
			{[
				{
					view: "structured-workspaces" as const,
					label: t("structured_workspaces"),
					Icon: PanelsTopLeft,
				},
				{ view: "docs" as const, label: t("documents"), Icon: Files },
				{ view: "photos" as const, label: t("photos"), Icon: Image },
				{
					view: "exchange" as const,
					label: t("exchanges"),
					Icon: MessageCircle,
				},
			].map((item) => (
				<button
					key={item.view}
					aria-label={item.label}
					title={item.view === "docs" ? t("mobile_documents_root") : item.label}
					type="button"
					aria-pressed={open && !settings && view === item.view}
					onClick={() =>
						item.view === "docs"
							? useStore.getState().filterDocumentsByCategory("")
							: open && !settings && view === item.view
								? close()
								: setView(item.view)
					}
					className="flex min-h-14 flex-1 items-center justify-center text-text-2 aria-pressed:text-accent"
				>
					<item.Icon size={28} aria-hidden="true" />
				</button>
			))}
			<button
				type="button"
				aria-label={t("settings")}
				title={t("settings")}
				aria-pressed={settings}
				onClick={toggleSettings}
				className="flex min-h-14 flex-1 items-center justify-center text-text-2 aria-pressed:text-accent"
			>
				<Settings size={28} aria-hidden="true" />
			</button>
		</nav>
	);
}
