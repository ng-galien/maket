import type { Collection } from "@maket/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocSummary, Document } from "./types";

// Silence the syncPending/syncWorkspace setTimeout → wsSend(null) no-op chatter.
// Must be hoisted above the useStore import so the mocked wsSend is bound at
// module init time.
vi.mock("./ws", async () => {
	const actual = await vi.importActual<typeof import("./ws")>("./ws");
	return { ...actual, wsSend: vi.fn() };
});

const { useStore, cursorForPage, previewCursorForPage } = await import(
	"./useStore"
);
const { wsSend } = await import("./ws");
const { consumePendingFit, consumeWorkspaceRemovalFitSuppression } =
	await import("./zoomBridge");

// Snapshot of the store's initial shape so each test can reset cleanly.
// Captured once after module import — before any test mutates state.
const INITIAL = useStore.getState();

function resetStore() {
	useStore.setState(
		{
			...INITIAL,
			docs: new Map(),
			workspaceDocNames: [],
			focusedDocName: null,
			focusedPageIndex: 0,
			docList: [],
			chartesCss: new Map(),
			chartesVersion: 0,
			collections: [],
			collectionCursors: {},
			draftCursorOverrides: {},
			collectionDrafts: {},
			assets: [],
			assetsLoaded: false,
			assetsLoading: false,
			selectedIds: [],
			editingElementId: null,
			showPopover: false,
			pending: [],
			libraryView: "docs",
			libraryOpen: true,
			settingsOpen: false,
			locked: false,
			zoom: 100,
		},
		true,
	);
}

const clientsCollection: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { client_name: { type: "string" } },
		required: ["client_name"],
		additionalProperties: false,
	},
	members: [
		{ id: "member_1", position: 0, data: { client_name: "Acme" } },
		{ id: "member_2", position: 1, data: { client_name: "Globex" } },
	],
};

function makeDoc(
	name: string,
	category = "flyer",
	pageCount = 1,
	activePage = 0,
): Document {
	return {
		id: `id-${name}`,
		name,
		category,
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: Array.from({ length: pageCount }, (_, index) => ({
			id: `${name}-page-${index + 1}`,
			name: `p${index + 1}`,
			elements: [],
		})),
		activePage,
	};
}

function bindCollection(doc: Document, collection: string): Document {
	const page = doc.pages[doc.activePage];
	if (!page) throw new Error("fixture document has no active page");
	page.collection = { name: collection };
	return doc;
}

function summary(name: string, category = "flyer"): DocSummary {
	return {
		id: `id-${name}`,
		name,
		category,
		format: "A4",
		pageCount: 1,
		elementCount: 0,
		collectionBindings: [],
	};
}

beforeEach(() => {
	consumeWorkspaceRemovalFitSuppression();
	consumePendingFit();
	vi.mocked(wsSend).mockClear();
	resetStore();
});

afterEach(() => vi.unstubAllGlobals());

describe("asset mirror", () => {
	it("keeps a newer WS category delta when an older HTTP snapshot resolves", async () => {
		let resolveJson: (value: {
			images: Array<{ file: string; category: string }>;
		}) => void = () => {};
		const json = new Promise<{
			images: Array<{ file: string; category: string }>;
		}>((resolve) => {
			resolveJson = resolve;
		});
		const fetchMock = vi.fn(async () => ({ json: () => json }));
		vi.stubGlobal("fetch", fetchMock);
		useStore.setState({
			assets: [{ file: "hero.png", category: "Archive" }],
			assetsLoaded: true,
		});

		const loading = useStore.getState().loadAssets(true);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		useStore
			.getState()
			.applyAssetCategoryUpdates([
				{ filename: "hero.png", category: "Campaigns" },
			]);
		resolveJson({ images: [{ file: "hero.png", category: "Archive" }] });
		await loading;

		expect(useStore.getState().assets).toEqual([
			{ file: "hero.png", category: "Campaigns" },
		]);
	});
});

describe("upsertDoc", () => {
	it("adds the doc to workspace and takes focus when nothing is focused", () => {
		const doc = makeDoc("alpha");
		useStore.getState().upsertDoc(doc, [summary("alpha")], "/* css */");
		const s = useStore.getState();
		expect(s.docs.get("alpha")).toEqual(doc);
		expect(s.workspaceDocNames).toEqual(["alpha"]);
		expect(s.focusedDocName).toBe("alpha");
		expect(s.chartesCss.get("alpha")).toBe("/* css */");
	});

	it("does not steal focus from an already-focused doc", () => {
		const a = makeDoc("alpha");
		const b = makeDoc("beta");
		useStore.getState().upsertDoc(a, [summary("alpha")], "");
		useStore.getState().upsertDoc(b, [summary("alpha"), summary("beta")], "");
		expect(useStore.getState().focusedDocName).toBe("alpha");
		expect(useStore.getState().workspaceDocNames).toEqual(["alpha", "beta"]);
	});

	it("steals focus when focus=true", () => {
		const a = makeDoc("alpha");
		const b = makeDoc("beta", "flyer", 3, 2);
		useStore.getState().upsertDoc(a, [summary("alpha")], "");
		useStore
			.getState()
			.upsertDoc(b, [summary("alpha"), summary("beta")], "", true, true);
		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedPageIndex).toBe(2);
	});

	it("keeps the reader on its current document during server-focused work", () => {
		const alpha = makeDoc("alpha", "report", 3, 1);
		const beta = makeDoc("beta", "report", 2, 1);
		useStore.getState().upsertDoc(alpha, [summary("alpha")], "");
		useStore.setState({ workspaceView: "reading", focusedPageIndex: 1 });

		useStore
			.getState()
			.upsertDoc(beta, [summary("alpha"), summary("beta")], "", true, true);

		expect(useStore.getState().focusedDocName).toBe("alpha");
		expect(useStore.getState().focusedPageIndex).toBe(1);
		expect(useStore.getState().docs.has("beta")).toBe(true);
	});

	it("accepts an explicit user focus while reading", () => {
		const alpha = makeDoc("alpha", "report", 3, 1);
		const beta = makeDoc("beta", "report", 3, 2);
		useStore.getState().upsertDoc(alpha, [summary("alpha")], "");
		useStore.setState({ workspaceView: "reading", focusedPageIndex: 1 });

		useStore
			.getState()
			.upsertDoc(
				beta,
				[summary("alpha"), summary("beta")],
				"",
				true,
				true,
				true,
			);

		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedPageIndex).toBe(2);
	});

	it("reveals an explicitly opened document without closing collection data", () => {
		const alpha = makeDoc("alpha");
		const beta = bindCollection(makeDoc("beta"), "clients");
		useStore.getState().upsertDoc(alpha, [summary("alpha")], "");
		useStore.setState({
			focusedCollectionName: "clients",
			dataDockMode: "expanded",
		});

		useStore
			.getState()
			.upsertDoc(
				beta,
				[summary("alpha"), summary("beta")],
				"",
				true,
				true,
				true,
			);

		expect(useStore.getState()).toMatchObject({
			focusedDocName: "beta",
			focusedCollectionName: "clients",
			dataDockMode: "split",
		});
	});

	it("preserves the locally selected page on background state updates", () => {
		const doc = makeDoc("alpha", "flyer", 3);
		useStore.getState().upsertDoc(doc, [summary("alpha")], "");
		useStore.getState().setFocusedPage("alpha", 2);

		useStore
			.getState()
			.upsertDoc({ ...doc, activePage: 0 }, [summary("alpha")], "");

		expect(useStore.getState().focusedPageIndex).toBe(2);
	});

	it("tracks the selected page by id when pages are reordered", () => {
		const doc = makeDoc("alpha", "flyer", 3);
		useStore.getState().upsertDoc(doc, [summary("alpha")], "");
		useStore.getState().setFocusedPage("alpha", 1);

		useStore.getState().upsertDoc(
			{
				...doc,
				pages: [doc.pages[1], doc.pages[0], doc.pages[2]],
				activePage: 2,
			},
			[summary("alpha")],
			"",
		);

		expect(useStore.getState().focusedPageIndex).toBe(0);
	});

	it("falls back to the server active page when the selected page is removed", () => {
		const doc = makeDoc("alpha", "flyer", 3);
		useStore.getState().upsertDoc(doc, [summary("alpha")], "");
		useStore.getState().setFocusedPage("alpha", 1);

		useStore.getState().upsertDoc(
			{
				...doc,
				pages: [doc.pages[0], doc.pages[2]],
				activePage: 1,
			},
			[summary("alpha")],
			"",
		);

		expect(useStore.getState().focusedPageIndex).toBe(1);
	});

	it("skips workspace insertion when addToWorkspace=false", () => {
		const a = makeDoc("alpha");
		useStore.getState().upsertDoc(a, [summary("alpha")], "", false, false);
		expect(useStore.getState().workspaceDocNames).toEqual([]);
		expect(useStore.getState().docs.get("alpha")).toEqual(a);
	});

	it("groups same-category docs together when inserting", () => {
		useStore.setState({ workspaceDocNames: ["flyer-1", "poster-1"] });
		const docs = [
			summary("flyer-1", "flyer"),
			summary("poster-1", "poster"),
			summary("flyer-2", "flyer"),
		];
		useStore.getState().upsertDoc(makeDoc("flyer-2", "flyer"), docs, "");
		// flyer-2 slots in after flyer-1, before poster-1
		expect(useStore.getState().workspaceDocNames).toEqual([
			"flyer-1",
			"flyer-2",
			"poster-1",
		]);
	});

	it("persists workspace to localStorage", () => {
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");
		expect(JSON.parse(localStorage.getItem("maket-workspace") || "[]")).toEqual(
			["alpha"],
		);
		expect(localStorage.getItem("maket-focused-doc")).toBe("alpha");
	});
});

describe("replaceRenamedDoc", () => {
	it("replaces the workspace identity while preserving focus, page and reader mode", () => {
		const oldDoc = makeDoc("old", "report", 3, 0);
		const otherDoc = makeDoc("other", "report", 1, 0);
		const renamedDoc = { ...oldDoc, name: "renamed" };
		useStore.setState({
			docs: new Map([
				[oldDoc.name, oldDoc],
				[otherDoc.name, otherDoc],
			]),
			workspaceDocNames: [oldDoc.name, otherDoc.name],
			focusedDocName: oldDoc.name,
			focusedPageIndex: 2,
			workspaceView: "reading",
			chartesCss: new Map([[oldDoc.name, "/* old */"]]),
		});

		useStore
			.getState()
			.replaceRenamedDoc(
				oldDoc.name,
				renamedDoc,
				[summary("renamed"), summary("other")],
				"/* renamed */",
			);

		const state = useStore.getState();
		expect(state.workspaceDocNames).toEqual(["renamed", "other"]);
		expect(state.docs.has("old")).toBe(false);
		expect(state.docs.get("renamed")).toEqual(renamedDoc);
		expect(state.focusedDocName).toBe("renamed");
		expect(state.focusedPageIndex).toBe(2);
		expect(state.workspaceView).toBe("reading");
		expect(state.chartesCss.has("old")).toBe(false);
		expect(state.chartesCss.get("renamed")).toBe("/* renamed */");
	});

	it("does not steal focus from another open document", () => {
		const oldDoc = makeDoc("old");
		const otherDoc = makeDoc("other");
		useStore.setState({
			docs: new Map([
				[oldDoc.name, oldDoc],
				[otherDoc.name, otherDoc],
			]),
			workspaceDocNames: [oldDoc.name, otherDoc.name],
			focusedDocName: otherDoc.name,
			focusedPageIndex: 0,
		});

		useStore
			.getState()
			.replaceRenamedDoc(
				oldDoc.name,
				{ ...oldDoc, name: "renamed" },
				[summary("renamed"), summary("other")],
				"",
			);

		expect(useStore.getState().focusedDocName).toBe("other");
		expect(useStore.getState().workspaceDocNames).toEqual(["renamed", "other"]);
	});
});

describe("workspace / focus", () => {
	it("closeWorkspaceDocuments reassigns focus to the last remaining doc", () => {
		useStore
			.getState()
			.upsertDoc(makeDoc("alpha", "flyer", 2, 1), [summary("alpha")], "");
		useStore
			.getState()
			.upsertDoc(
				makeDoc("beta"),
				[summary("alpha"), summary("beta")],
				"",
				true,
				true,
			);
		expect(useStore.getState().focusedDocName).toBe("beta");
		useStore.getState().closeWorkspaceDocuments(["beta"]);
		const s = useStore.getState();
		expect(s.workspaceDocNames).toEqual(["alpha"]);
		expect(s.focusedDocName).toBe("alpha");
		expect(s.focusedPageIndex).toBe(1);
		expect(s.selectedIds).toEqual([]);
		expect(localStorage.getItem("maket-focused-doc")).toBe("alpha");
	});

	it("keeps the remaining document focused after a stale close-handle event", () => {
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");
		useStore
			.getState()
			.upsertDoc(
				makeDoc("beta"),
				[summary("alpha"), summary("beta")],
				"",
				true,
				true,
			);

		useStore.getState().closeWorkspaceDocuments(["beta"]);
		expect(useStore.getState().focusedDocName).toBe("alpha");

		// The removed frame may finish dispatching its click after the close.
		useStore.getState().setFocusedDoc("beta");

		const state = useStore.getState();
		expect(state.workspaceDocNames).toEqual(["alpha"]);
		expect(state.focusedDocName).toBe("alpha");
		expect(localStorage.getItem("maket-focused-doc")).toBe("alpha");
	});

	it("allows an empty focus only when the workspace is empty", () => {
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");

		useStore.getState().setFocusedDoc(null);
		expect(useStore.getState().focusedDocName).toBe("alpha");

		useStore.getState().closeWorkspaceDocuments(["alpha"]);
		expect(useStore.getState().focusedDocName).toBeNull();
	});

	it("closeWorkspaceDocuments leaves focus alone when closing a non-focused doc", () => {
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");
		useStore
			.getState()
			.upsertDoc(makeDoc("beta"), [summary("alpha"), summary("beta")], "");
		useStore.setState({ selectedIds: ["x"] });
		useStore.getState().closeWorkspaceDocuments(["beta"]);
		const s = useStore.getState();
		expect(s.focusedDocName).toBe("alpha");
		expect(s.selectedIds).toEqual(["x"]);
	});

	it("closeWorkspaceDocuments does not suppress a future fit when the doc is not open", () => {
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");
		useStore.getState().closeWorkspaceDocuments(["absent"]);

		expect(useStore.getState().workspaceDocNames).toEqual(["alpha"]);
		expect(useStore.getState().focusedDocName).toBe("alpha");
		expect(consumeWorkspaceRemovalFitSuppression()).toBe(false);
	});

	it("loads and frames the remaining focused document when its content is missing", () => {
		useStore.setState({
			docs: new Map([["alpha", makeDoc("alpha")]]),
			workspaceDocNames: ["alpha", "beta"],
			focusedDocName: "alpha",
			focusedPageIndex: 0,
			workspaceView: "canvas",
		});

		useStore.getState().closeWorkspaceDocuments(["alpha"]);

		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(localStorage.getItem("maket-focused-doc")).toBe("beta");
		expect(wsSend).toHaveBeenCalledWith({
			type: "load_document",
			name: "beta",
		});
		expect(consumePendingFit()).toEqual({
			target: { docName: "beta", pageIndex: 0 },
		});
	});

	it("addDocToWorkspace is idempotent", () => {
		useStore.getState().addDocToWorkspace("alpha");
		useStore.getState().addDocToWorkspace("alpha");
		expect(useStore.getState().workspaceDocNames).toEqual(["alpha"]);
		expect(useStore.getState().focusedDocName).toBe("alpha");
	});

	it("openWorkspaceDocument reuses focus navigation for an open document", () => {
		const alpha = makeDoc("alpha");
		const beta = bindCollection(makeDoc("beta"), "projects");
		useStore.setState({
			docs: new Map([
				["alpha", alpha],
				["beta", beta],
			]),
			workspaceDocNames: ["alpha", "beta"],
			focusedDocName: "alpha",
			focusedCollectionName: "clients",
			dataDockMode: "expanded",
		});

		useStore.getState().openWorkspaceDocument("beta");

		expect(useStore.getState()).toMatchObject({
			focusedDocName: "beta",
			focusedCollectionName: "projects",
			dataDockMode: "split",
		});
		expect(consumePendingFit()).toEqual({ target: { docName: "beta" } });
	});

	it("setFocusedDoc is a no-op when unchanged", () => {
		useStore.setState({
			workspaceDocNames: ["alpha"],
			focusedDocName: "alpha",
			selectedIds: ["x"],
		});
		useStore.getState().setFocusedDoc("alpha");
		expect(useStore.getState().selectedIds).toEqual(["x"]);
	});

	it("setFocusedDoc clears selection when changing doc", () => {
		const beta = makeDoc("beta", "flyer", 3, 2);
		useStore.setState({
			docs: new Map([["beta", beta]]),
			workspaceDocNames: ["alpha", "beta"],
			focusedDocName: "alpha",
			focusedPageIndex: 0,
			selectedIds: ["x"],
		});
		useStore.getState().setFocusedDoc("beta");
		expect(useStore.getState().selectedIds).toEqual([]);
		expect(useStore.getState().focusedPageIndex).toBe(2);
	});

	it("setFocusedPage focuses the doc, clamps the page, and clears selection", () => {
		const beta = makeDoc("beta", "flyer", 3);
		useStore.setState({
			docs: new Map([["beta", beta]]),
			workspaceDocNames: ["alpha", "beta"],
			focusedDocName: "alpha",
			focusedPageIndex: 0,
			selectedIds: ["x"],
		});

		useStore.getState().setFocusedPage("beta", 99);

		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedPageIndex).toBe(2);
		expect(useStore.getState().selectedIds).toEqual([]);
	});

	it("setFocusedPage is a no-op when the active page is unchanged", () => {
		const alpha = makeDoc("alpha", "flyer", 2);
		useStore.setState({
			docs: new Map([["alpha", alpha]]),
			workspaceDocNames: ["alpha"],
			focusedDocName: "alpha",
			focusedPageIndex: 1,
			selectedIds: ["x"],
		});

		useStore.getState().setFocusedPage("alpha", 1);

		expect(useStore.getState().selectedIds).toEqual(["x"]);
	});

	it("setFocusedDoc keeps the collection available while revealing the document", () => {
		const alpha = makeDoc("alpha");
		const beta = bindCollection(makeDoc("beta"), "clients");
		useStore.setState({
			docs: new Map([
				["alpha", alpha],
				["beta", beta],
			]),
			workspaceDocNames: ["alpha", "beta"],
			focusedDocName: "alpha",
			focusedCollectionName: "clients",
			dataDockMode: "expanded",
		});
		useStore.getState().setFocusedDoc("beta");
		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedCollectionName).toBe("clients");
		expect(useStore.getState().dataDockMode).toBe("split");
	});

	it("setFocusedDoc reveals an already focused document behind expanded data", () => {
		const alpha = bindCollection(makeDoc("alpha"), "clients");
		useStore.setState({
			docs: new Map([["alpha", alpha]]),
			workspaceDocNames: ["alpha"],
			focusedDocName: "alpha",
			focusedCollectionName: "clients",
			dataDockMode: "expanded",
			selectedIds: ["title"],
		});

		useStore.getState().setFocusedDoc("alpha");

		expect(useStore.getState()).toMatchObject({
			focusedDocName: "alpha",
			focusedCollectionName: "clients",
			dataDockMode: "split",
			selectedIds: ["title"],
		});
	});

	it("closes collection data when the focused document has no binding", () => {
		const alpha = bindCollection(makeDoc("alpha"), "clients");
		const beta = makeDoc("beta");
		useStore.setState({
			docs: new Map([
				["alpha", alpha],
				["beta", beta],
			]),
			workspaceDocNames: ["alpha", "beta"],
			focusedDocName: "alpha",
			focusedCollectionName: "clients",
			dataDockMode: "split",
		});

		useStore.getState().setFocusedDoc("beta");

		expect(useStore.getState()).toMatchObject({
			focusedDocName: "beta",
			focusedCollectionName: null,
			dataDockMode: "split",
		});
	});

	it("setFocusedCollection keeps the focused document controls open", () => {
		useStore.setState({ focusedDocName: "alpha", selectedIds: ["x"] });
		useStore.getState().setFocusedCollection("clients");
		expect(useStore.getState().focusedDocName).toBe("alpha");
		expect(useStore.getState().focusedCollectionName).toBe("clients");
		expect(useStore.getState().selectedIds).toEqual([]);
	});
});

describe("selection", () => {
	it("selectElement(null) clears selection and popover", () => {
		useStore.setState({ selectedIds: ["x"], showPopover: true });
		useStore.getState().selectElement(null);
		expect(useStore.getState().selectedIds).toEqual([]);
		expect(useStore.getState().showPopover).toBe(false);
	});

	it("selectElement(id, toggle=true) toggles membership", () => {
		useStore.getState().selectElement("a", true);
		useStore.getState().selectElement("b", true);
		expect(useStore.getState().selectedIds).toEqual(["a", "b"]);
		useStore.getState().selectElement("a", true);
		expect(useStore.getState().selectedIds).toEqual(["b"]);
	});

	it("selectElement(id) replaces selection", () => {
		useStore.setState({ selectedIds: ["a", "b"] });
		useStore.getState().selectElement("c");
		expect(useStore.getState().selectedIds).toEqual(["c"]);
	});
});

describe("UI preferences", () => {
	it("selects one library view and keeps the pane open", () => {
		useStore.setState({ libraryOpen: false });
		useStore.getState().setLibraryView("collections");
		expect(useStore.getState()).toMatchObject({
			libraryView: "collections",
			libraryOpen: true,
		});
		expect(localStorage.getItem("maket-library-view")).toBe("collections");
	});

	it("setWorkspaceView persists the reading layout preference", () => {
		useStore.getState().setWorkspaceView("reading");
		expect(useStore.getState().workspaceView).toBe("reading");
		expect(localStorage.getItem("maket-workspace-view")).toBe("reading");
	});

	it("toggleDarkMode flips and persists", () => {
		useStore.setState({ darkMode: false, themeMode: "light" });
		useStore.getState().toggleDarkMode();
		expect(useStore.getState()).toMatchObject({
			darkMode: true,
			themeMode: "dark",
		});
		expect(localStorage.getItem("maket-theme-mode")).toBe("dark");
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it("opens settings as a full-page destination and restores the library", () => {
		useStore.setState({ libraryOpen: true, settingsOpen: false });
		useStore.getState().toggleSettings();
		expect(useStore.getState()).toMatchObject({
			settingsOpen: true,
			libraryOpen: false,
		});

		useStore.getState().toggleLibrary();
		expect(useStore.getState()).toMatchObject({
			settingsOpen: false,
			libraryOpen: true,
		});
	});

	it("toggles and persists the library visibility", () => {
		useStore.setState({ libraryOpen: true });
		useStore.getState().toggleLibrary();
		expect(useStore.getState().libraryOpen).toBe(false);
		expect(localStorage.getItem("maket-library-open")).toBe("false");
	});

	it("toggles and persists whether the library is pinned", () => {
		useStore.setState({ libraryOpen: true, libraryPinned: false });
		useStore.getState().toggleLibraryPinned();
		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryPinned: true,
		});
		expect(localStorage.getItem("maket-library-pinned")).toBe("true");

		useStore.getState().toggleLibraryPinned();
		expect(useStore.getState()).toMatchObject({
			libraryOpen: false,
			libraryPinned: false,
		});
		expect(localStorage.getItem("maket-library-pinned")).toBe("false");
		expect(localStorage.getItem("maket-library-open")).toBe("false");
	});

	it("opens agent exchanges in the same left navigation", () => {
		useStore.setState({ libraryOpen: false, libraryView: "docs" });
		useStore.getState().setLibraryView("exchange");
		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryView: "exchange",
		});
		expect(localStorage.getItem("maket-library-view")).toBe("exchange");
	});
});

describe("collection cursors", () => {
	function boundDoc(name = "alpha"): Document {
		const doc = makeDoc(name);
		const page = doc.pages[0];
		if (page) page.collection = { name: "clients" };
		return doc;
	}

	function seed(name = "alpha") {
		const doc = boundDoc(name);
		useStore.getState().upsertDoc(doc, [summary(name)], "");
		useStore.getState().setCollections([clientsCollection]);
		return doc;
	}

	beforeEach(() => {
		vi.mocked(wsSend).mockClear();
	});

	it("defaults the cursor of a bound page to single-row mode, first row", () => {
		seed();
		expect(cursorForPage(useStore.getState(), "alpha", 0)).toEqual({
			docName: "alpha",
			pageIndex: 0,
			collection: "clients",
			mode: "rendered",
			memberId: "member_1",
		});
	});

	it("returns null for unbound pages", () => {
		useStore.getState().upsertDoc(makeDoc("plain"), [summary("plain")], "");
		expect(cursorForPage(useStore.getState(), "plain", 0)).toBeNull();
	});

	it("mirrors server cursors wholesale and prefers them over defaults", () => {
		seed();
		useStore.getState().setCollectionCursors([
			{
				docName: "alpha",
				pageIndex: 0,
				collection: "clients",
				mode: "rendered",
				memberId: "member_2",
			},
		]);
		expect(cursorForPage(useStore.getState(), "alpha", 0)).toEqual(
			expect.objectContaining({ mode: "rendered", memberId: "member_2" }),
		);
	});

	it("ignores a mirrored cursor whose collection no longer matches the binding", () => {
		seed();
		useStore.getState().setCollectionCursors([
			{
				docName: "alpha",
				pageIndex: 0,
				collection: "products",
				mode: "all",
				memberId: null,
			},
		]);
		expect(cursorForPage(useStore.getState(), "alpha", 0)).toEqual(
			expect.objectContaining({
				collection: "clients",
				mode: "rendered",
				memberId: "member_1",
			}),
		);
	});

	it("sends cursor mutations to the server instead of mutating locally", () => {
		seed();
		useStore.getState().setCursorMode("alpha", 0, "rendered");
		expect(wsSend).toHaveBeenCalledWith({
			type: "collection_cursor_set",
			docName: "alpha",
			pageIndex: 0,
			mode: "rendered",
		});
		useStore.getState().setCursorMember("alpha", 0, "member_2");
		expect(wsSend).toHaveBeenCalledWith({
			type: "collection_cursor_set",
			docName: "alpha",
			pageIndex: 0,
			memberId: "member_2",
		});
		expect(cursorForPage(useStore.getState(), "alpha", 0)?.mode).toBe(
			"rendered",
		);
	});

	it("updates preview cursors locally in the read-only viewer", () => {
		seed();
		useStore.setState({ readOnly: true });
		vi.mocked(wsSend).mockClear();

		useStore.getState().setCursorMode("alpha", 0, "rendered");
		useStore.getState().setCursorMember("alpha", 0, "member_2");
		expect(cursorForPage(useStore.getState(), "alpha", 0)).toEqual(
			expect.objectContaining({ mode: "rendered", memberId: "member_2" }),
		);
		useStore.getState().moveCursorMember("alpha", 0, -1);
		expect(cursorForPage(useStore.getState(), "alpha", 0)?.memberId).toBe(
			"member_1",
		);
		expect(wsSend).not.toHaveBeenCalled();
	});

	it("previews draft-only rows locally and promotes them once saved", () => {
		seed();
		const member3 = {
			id: "member_3",
			position: 2,
			data: { client_name: "Soylent" },
		};
		useStore.getState().setCollectionDraft({
			...clientsCollection,
			members: [...clientsCollection.members, member3],
		});
		useStore.getState().setDraftCursorOverride("alpha", 0, "member_3");

		// The canvas preview follows the local override…
		expect(
			previewCursorForPage(useStore.getState(), "alpha", 0)?.memberId,
		).toBe("member_3");
		// …while the shared server cursor is untouched.
		expect(cursorForPage(useStore.getState(), "alpha", 0)?.memberId).toBe(
			"member_1",
		);

		// Server push now contains the row (the draft was saved): the override
		// is promoted to the shared cursor and cleared.
		vi.mocked(wsSend).mockClear();
		useStore.getState().setCollections([
			{
				...clientsCollection,
				members: [...clientsCollection.members, member3],
			},
		]);
		expect(wsSend).toHaveBeenCalledWith({
			type: "collection_cursor_set",
			docName: "alpha",
			pageIndex: 0,
			memberId: "member_3",
		});
		expect(useStore.getState().draftCursorOverrides).toEqual({});
	});

	it("drops the local override when the draft is discarded", () => {
		seed();
		useStore.getState().setCollectionDraft({
			...clientsCollection,
			members: [
				...clientsCollection.members,
				{ id: "member_3", position: 2, data: { client_name: "Soylent" } },
			],
		});
		useStore.getState().setDraftCursorOverride("alpha", 0, "member_3");

		useStore.getState().clearCollectionDraft("clients");

		expect(useStore.getState().draftCursorOverrides).toEqual({});
		expect(
			previewCursorForPage(useStore.getState(), "alpha", 0)?.memberId,
		).toBe("member_1");
	});

	it("moves the cursor row within bounds and skips no-op moves", () => {
		seed();
		useStore.getState().moveCursorMember("alpha", 0, 1);
		expect(wsSend).toHaveBeenCalledWith({
			type: "collection_cursor_set",
			docName: "alpha",
			pageIndex: 0,
			memberId: "member_2",
		});
		// Mirror the server acknowledging the move, then clamp at the end.
		useStore.getState().setCollectionCursors([
			{
				docName: "alpha",
				pageIndex: 0,
				collection: "clients",
				mode: "template",
				memberId: "member_2",
			},
		]);
		vi.mocked(wsSend).mockClear();
		useStore.getState().moveCursorMember("alpha", 0, 1);
		expect(wsSend).not.toHaveBeenCalled();
		useStore.getState().moveCursorMember("alpha", 0, -1);
		expect(wsSend).toHaveBeenCalledWith(
			expect.objectContaining({ memberId: "member_1" }),
		);
	});
});

describe("setServerState (legacy shim)", () => {
	it("delegates to upsertDoc when a doc is supplied", () => {
		useStore
			.getState()
			.setServerState(makeDoc("alpha"), [summary("alpha")], "");
		expect(useStore.getState().docs.has("alpha")).toBe(true);
	});

	it("updates docList only when doc is null", () => {
		useStore.setState({ docList: [] });
		useStore.getState().setServerState(null, [summary("alpha")], "");
		expect(useStore.getState().docList).toHaveLength(1);
		expect(useStore.getState().docs.size).toBe(0);
	});
});
