import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import { cancelDocumentLoads } from "../store/ws";
import { installMobileHistory } from "./mobileHistory";

const fields = [
	"libraryView",
	"libraryOpen",
	"settingsOpen",
	"workspaceView",
	"workspaceDocNames",
	"focusedDocName",
	"focusedPageIndex",
	"activeStructuredWorkspaceId",
	"activeStructuredCollectionId",
	"structuredWorkspaceLayout",
	"messageAnchor",
	"annotationDocName",
] as const;

/** Restores presentation context only; never replays an annotation or document
 * edit. Installed once the first hydration is done, then kept for the page's
 * life, so a lost connection neither replays nor truncates the session stack. */
export function useMobileNavigation(active: boolean) {
	const hydrated = useStore(
		(state) => state.settingsHydrated && state.connected,
	);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		if (hydrated) setReady(true);
	}, [hydrated]);
	useEffect(() => {
		if (!active || !ready) return;
		return installMobileHistory({
			read: () => {
				const state = useStore.getState();
				return {
					...Object.fromEntries(fields.map((key) => [key, state[key]])),
					focusedDocId: state.focusedDocName
						? (state.docs.get(state.focusedDocName)?.id ??
							state.docList.find((doc) => doc.name === state.focusedDocName)
								?.id)
						: undefined,
				};
			},
			restore: (shell) => {
				const state = useStore.getState();
				const restored = Object.fromEntries(
					fields.filter((key) => key in shell).map((key) => [key, shell[key]]),
				) as Partial<typeof state>;
				const currentDocument = state.docList.find(
					(doc) => doc.id === shell.focusedDocId,
				);
				if (
					currentDocument &&
					restored.focusedDocName !== currentDocument.name
				) {
					const previousName = restored.focusedDocName;
					restored.focusedDocName = currentDocument.name;
					restored.workspaceDocNames = restored.workspaceDocNames?.map(
						(name) => (name === previousName ? currentDocument.name : name),
					);
				}
				useStore.setState({
					...restored,
					selectedIds: restored.messageAnchor?.elementId
						? [restored.messageAnchor.elementId]
						: [],
				});
				loadRestoredDocument(restored);
			},
			subscribe: useStore.subscribe,
			base: catalogueBeneathReading,
		});
	}, [active, ready]);
}

function loadRestoredDocument(
	restored: Partial<ReturnType<typeof useStore.getState>>,
) {
	cancelDocumentLoads(new Set(), true);
	const state = useStore.getState();
	if (restored.focusedDocName && !state.docs.has(restored.focusedDocName))
		useStore.getState().openWorkspaceDocument(
			restored.focusedDocName,
			restored.activeStructuredWorkspaceId
				? {
						workspaceId: restored.activeStructuredWorkspaceId,
						collectionId: restored.activeStructuredCollectionId ?? undefined,
					}
				: undefined,
		);
}

/** A session that starts on a restored reading keeps the catalogue beneath it. */
function catalogueBeneathReading(
	shell: Record<string, unknown>,
): Record<string, unknown> | null {
	return shell.focusedDocName && !shell.libraryOpen && !shell.settingsOpen
		? { libraryOpen: true }
		: null;
}
