import { useEffect } from "react";
import { Board } from "./components/Board";
import { BottomBar } from "./components/BottomBar";
import { ChartesTab } from "./components/ChartesTab";
import { CollectionsTab } from "./components/CollectionsTab";
import { CollectionWorkspace } from "./components/CollectionWorkspace";
import { DocsTab } from "./components/DocsTab";
import { MessagesPanel } from "./components/MessagesPanel";
import { PhotosTab } from "./components/PhotosTab";
import { Popover } from "./components/Popover";
import { ReadingWorkspace } from "./components/ReadingWorkspace";
import { SidePanel } from "./components/SidePanel";
import { useT } from "./i18n/useT";
import { applyColorScheme } from "./lib/colorScheme";
import { useStore } from "./store/useStore";
import { initWs } from "./store/ws";

export default function App() {
	const t = useT();
	const activePanel = useStore((s) => s.activePanel);
	const locked = useStore((s) => s.locked);
	const workspaceView = useStore((s) => s.workspaceView);
	const hasFocusedDoc = useStore((s) =>
		s.focusedDocName ? s.docs.has(s.focusedDocName) : false,
	);
	const closePanel = () => useStore.getState().setActivePanel(null);

	const darkMode = useStore((s) => s.darkMode);

	useEffect(() => {
		initWs();
		applyColorScheme(useStore.getState().darkMode);
	}, []);

	useEffect(() => {
		applyColorScheme(darkMode);
	}, [darkMode]);

	return (
		<div className="relative h-full w-full">
			{workspaceView === "reading" && hasFocusedDoc ? (
				<ReadingWorkspace />
			) : (
				<>
					<Board locked={locked} />
					<BottomBar />

					<SidePanel
						id="panel-chartes"
						label={t("chartes")}
						closeLabel={t("close_panel", { panel: t("chartes") })}
						open={activePanel === "chartes"}
						onClose={closePanel}
						side="left"
					>
						<ChartesTab />
					</SidePanel>

					<SidePanel
						id="panel-photos"
						label={t("photos")}
						closeLabel={t("close_panel", { panel: t("photos") })}
						open={activePanel === "photos"}
						onClose={closePanel}
						side="left"
					>
						<PhotosTab />
					</SidePanel>

					<SidePanel
						id="panel-docs"
						label={t("documents")}
						closeLabel={t("close_panel", { panel: t("documents") })}
						open={activePanel === "docs"}
						onClose={closePanel}
						side="left"
						resizable
					>
						<DocsTab />
					</SidePanel>

					<SidePanel
						id="panel-collections"
						label={t("collections")}
						closeLabel={t("close_panel", { panel: t("collections") })}
						open={activePanel === "collections"}
						onClose={closePanel}
						side="left"
					>
						<CollectionsTab />
					</SidePanel>

					<Popover />
					<MessagesPanel />
					<CollectionWorkspace />
				</>
			)}
		</div>
	);
}
