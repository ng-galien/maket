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
import { SidePanel } from "./components/SidePanel";
import { useStore } from "./store/useStore";
import { initWs } from "./store/ws";

export default function App() {
	const activePanel = useStore((s) => s.activePanel);
	const locked = useStore((s) => s.locked);
	const closePanel = () => useStore.getState().setActivePanel(null);

	const darkMode = useStore((s) => s.darkMode);

	useEffect(() => {
		initWs();
		document.documentElement.style.colorScheme = useStore.getState().darkMode
			? "dark"
			: "light";
	}, []);

	useEffect(() => {
		document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
	}, [darkMode]);

	return (
		<div className="relative h-full w-full">
			<Board locked={locked} />
			<BottomBar />

			<SidePanel
				open={activePanel === "chartes"}
				onClose={closePanel}
				side="left"
			>
				<ChartesTab />
			</SidePanel>

			<SidePanel
				open={activePanel === "photos"}
				onClose={closePanel}
				side="left"
			>
				<PhotosTab />
			</SidePanel>

			<SidePanel open={activePanel === "docs"} onClose={closePanel} side="left">
				<DocsTab />
			</SidePanel>

			<SidePanel
				open={activePanel === "collections"}
				onClose={closePanel}
				side="left"
			>
				<CollectionsTab />
			</SidePanel>

			<Popover />
			<MessagesPanel />
			<CollectionWorkspace />
		</div>
	);
}
