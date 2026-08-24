import { useEffect, useRef } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { Board } from "./Board";
import {
	CollectionWorkspace,
	selectCollectionWorkspaceLayout,
} from "./CollectionWorkspace";
import { LibraryPanel } from "./LibraryPanel";
import { Popover } from "./Popover";
import { SettingsPage } from "./SettingsPage";
import { StateWorkspace } from "./StateWorkspace";
import { WorkspaceHeader } from "./WorkspaceHeader";

// Shell composition intentionally coordinates the independently owned UI zones.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function AppShell({ locked }: { locked: boolean }) {
	const t = useT();
	const canvasRef = useRef<HTMLDivElement>(null);
	const libraryOpen = useStore((state) => state.libraryOpen);
	const libraryPinned = useStore((state) => state.libraryPinned);
	const settingsOpen = useStore((state) => state.settingsOpen);
	const closeLastPanel = useStore((state) => state.closeLastPanel);
	const setDataDockMode = useStore((state) => state.setDataDockMode);
	const collectionLayout = useStore(selectCollectionWorkspaceLayout);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector('[role="dialog"]')) return;
			if (!libraryOpen && !settingsOpen) return;
			closeLastPanel();
			requestAnimationFrame(() => canvasRef.current?.focus());
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [closeLastPanel, libraryOpen, settingsOpen]);

	const expandedDocumentPreview = collectionLayout === "expanded-linked";
	const dataOnly = collectionLayout === "expanded-data";
	return (
		<div
			data-app-shell
			className="relative flex h-full w-full flex-col overflow-hidden bg-app"
		>
			<WorkspaceHeader />
			<div data-shell-workarea className="relative flex min-h-0 flex-1">
				{libraryOpen && !libraryPinned && (
					<button
						type="button"
						aria-label={t("close_active_panel")}
						onClick={closeLastPanel}
						className="absolute inset-0 z-[calc(var(--z-panel)-1)] hidden bg-black/15 backdrop-blur-[1px] max-[959px]:block"
					/>
				)}
				<LibraryPanel />
				<section
					data-workspace-surface
					onPointerDownCapture={() => {
						if (libraryOpen && !libraryPinned) closeLastPanel();
					}}
					className="relative flex min-w-0 flex-1 flex-col"
				>
					{settingsOpen ? (
						<SettingsPage />
					) : (
						<>
							<div
								ref={canvasRef}
								tabIndex={-1}
								data-canvas-workspace
								data-document-preview={expandedDocumentPreview || undefined}
								className={`relative min-h-0 flex-1 outline-none transition-[flex-basis,opacity] duration-200 ${
									dataOnly
										? "hidden"
										: expandedDocumentPreview
											? "opacity-75"
											: ""
								}`}
							>
								<Board locked={locked} />
								{expandedDocumentPreview && (
									<button
										type="button"
										onClick={() => setDataDockMode("split")}
										className="absolute inset-0 z-10 flex items-start justify-center bg-app/10 pt-3 text-xs font-semibold text-text-2 transition-colors hover:bg-app/25 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
									>
										<span className="rounded-full border border-border bg-panel/95 px-3 py-1 shadow-sm">
											{t("collection_document_return_split")}
										</span>
									</button>
								)}
							</div>
							<CollectionWorkspace layout={collectionLayout} />
							<StateWorkspace />
						</>
					)}
				</section>
			</div>
			<Popover />
		</div>
	);
}
