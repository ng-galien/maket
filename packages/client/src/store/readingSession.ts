import { useStore } from "./useStore";
import { requestFit } from "./zoomBridge";

type StoreState = ReturnType<typeof useStore.getState>;

interface ReadingReturnState {
	focusedDocName: string;
	focusedPageIndex: number;
	focusedCollectionName: StoreState["focusedCollectionName"];
	dataDockMode: StoreState["dataDockMode"];
	stateDockOpen: boolean;
	libraryOpen: boolean;
	libraryView: StoreState["libraryView"];
	settingsOpen: boolean;
	selectedIds: string[];
	editingElementId: string | null;
	showPopover: boolean;
}

let returnState: ReadingReturnState | null = null;

/** Reader is a transient presentation layer. Capture the authoring shell before
 * hiding it so closing Reader can restore the exact document, page and panels. */
export function enterReadingSession(): boolean {
	const state = useStore.getState();
	if (!state.focusedDocName) return false;
	if (state.workspaceView !== "reading") {
		returnState = {
			focusedDocName: state.focusedDocName,
			focusedPageIndex: state.focusedPageIndex,
			focusedCollectionName: state.focusedCollectionName,
			dataDockMode: state.dataDockMode,
			stateDockOpen: state.stateDockOpen,
			libraryOpen: state.libraryOpen,
			libraryView: state.libraryView,
			settingsOpen: state.settingsOpen,
			selectedIds: [...state.selectedIds],
			editingElementId: state.editingElementId,
			showPopover: state.showPopover,
		};
	}
	state.setFocusedCollection(null);
	useStore.setState({
		selectedIds: [],
		editingElementId: null,
		showPopover: false,
	});
	state.setWorkspaceView("reading");
	return true;
}

export function exitReadingSession(): void {
	const state = useStore.getState();
	const snapshot = returnState;
	returnState = null;
	if (!snapshot) {
		state.setWorkspaceView("canvas");
		if (state.focusedDocName) {
			requestFit({
				docName: state.focusedDocName,
				pageIndex: state.focusedPageIndex,
			});
		}
		return;
	}

	const originalDocumentAvailable =
		state.workspaceDocNames.includes(snapshot.focusedDocName) &&
		state.docs.has(snapshot.focusedDocName);
	const focusedDocName = originalDocumentAvailable
		? snapshot.focusedDocName
		: state.focusedDocName;
	const focusedPageIndex = originalDocumentAvailable
		? snapshot.focusedPageIndex
		: state.focusedPageIndex;
	localStorage.setItem("maket-workspace-view", "canvas");
	localStorage.setItem("maket-focused-doc", focusedDocName ?? "");
	useStore.setState({
		workspaceView: "canvas",
		focusedDocName,
		focusedPageIndex,
		focusedCollectionName: originalDocumentAvailable
			? snapshot.focusedCollectionName
			: null,
		dataDockMode: snapshot.dataDockMode,
		stateDockOpen: originalDocumentAvailable ? snapshot.stateDockOpen : false,
		libraryOpen: snapshot.libraryOpen,
		libraryView: snapshot.libraryView,
		settingsOpen: snapshot.settingsOpen,
		selectedIds: originalDocumentAvailable ? snapshot.selectedIds : [],
		editingElementId: originalDocumentAvailable
			? snapshot.editingElementId
			: null,
		showPopover: originalDocumentAvailable ? snapshot.showPopover : false,
	});
	if (focusedDocName)
		requestFit({ docName: focusedDocName, pageIndex: focusedPageIndex });
}
