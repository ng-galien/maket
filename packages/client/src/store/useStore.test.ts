import type { Collection } from "@maket/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
			selectedIds: [],
			editingElementId: null,
			showPopover: false,
			pending: [],
			activePanel: null,
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

function summary(name: string, category = "flyer"): DocSummary {
	return {
		id: `id-${name}`,
		name,
		category,
		format: "A4",
		pageCount: 1,
		elementCount: 0,
	};
}

beforeEach(() => {
	resetStore();
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

describe("pending messages", () => {
	it("addPending appends and injects the focused doc name", () => {
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");
		useStore.getState().addPending({
			id: "m1",
			type: "note",
			text: "hello",
			ts: Date.now(),
		});
		const [msg] = useStore.getState().pending;
		expect(msg.id).toBe("m1");
		expect(msg.docName).toBe("alpha");
	});

	it("addPending preserves an explicit docName over focus", () => {
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");
		useStore.getState().addPending({
			id: "m1",
			type: "note",
			docName: "other",
			ts: 0,
		});
		expect(useStore.getState().pending[0].docName).toBe("other");
	});

	it("addPending honors an explicit `docName: undefined` as workspace scope", () => {
		// PhotosTab uploads create classify-images alerts that should land in
		// the workspace bucket regardless of which doc is focused.
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");
		useStore.getState().addPending({
			id: "m1",
			type: "classify-images",
			docName: undefined,
			text: "3 new images",
			ts: 0,
		});
		expect(useStore.getState().pending[0].docName).toBeUndefined();
	});

	it("removePending drops by id and leaves the rest", () => {
		useStore.setState({
			pending: [
				{ id: "a", type: "note", ts: 0 },
				{ id: "b", type: "note", ts: 0 },
			],
		});
		useStore.getState().removePending("a");
		expect(useStore.getState().pending.map((m) => m.id)).toEqual(["b"]);
	});
});

describe("workspace / focus", () => {
	it("removeDocFromWorkspace reassigns focus to the last remaining doc", () => {
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
		useStore.getState().removeDocFromWorkspace("beta");
		const s = useStore.getState();
		expect(s.workspaceDocNames).toEqual(["alpha"]);
		expect(s.focusedDocName).toBe("alpha");
		expect(s.focusedPageIndex).toBe(1);
		expect(s.selectedIds).toEqual([]);
	});

	it("removeDocFromWorkspace leaves focus alone when removing a non-focused doc", () => {
		useStore.getState().upsertDoc(makeDoc("alpha"), [summary("alpha")], "");
		useStore
			.getState()
			.upsertDoc(makeDoc("beta"), [summary("alpha"), summary("beta")], "");
		useStore.setState({ selectedIds: ["x"] });
		useStore.getState().removeDocFromWorkspace("beta");
		const s = useStore.getState();
		expect(s.focusedDocName).toBe("alpha");
		expect(s.selectedIds).toEqual(["x"]);
	});

	it("addDocToWorkspace is idempotent", () => {
		useStore.getState().addDocToWorkspace("alpha");
		useStore.getState().addDocToWorkspace("alpha");
		expect(useStore.getState().workspaceDocNames).toEqual(["alpha"]);
	});

	it("setFocusedDoc is a no-op when unchanged", () => {
		useStore.setState({ focusedDocName: "alpha", selectedIds: ["x"] });
		useStore.getState().setFocusedDoc("alpha");
		expect(useStore.getState().selectedIds).toEqual(["x"]);
	});

	it("setFocusedDoc clears selection when changing doc", () => {
		const beta = makeDoc("beta", "flyer", 3, 2);
		useStore.setState({
			docs: new Map([["beta", beta]]),
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
			focusedDocName: "alpha",
			focusedPageIndex: 1,
			selectedIds: ["x"],
		});

		useStore.getState().setFocusedPage("alpha", 1);

		expect(useStore.getState().selectedIds).toEqual(["x"]);
	});

	it("setFocusedDoc keeps the opened collection workspace", () => {
		useStore.setState({
			focusedDocName: "alpha",
			focusedCollectionName: "clients",
		});
		useStore.getState().setFocusedDoc("beta");
		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedCollectionName).toBe("clients");
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
	it("setBarPosition persists to localStorage", () => {
		useStore.getState().setBarPosition("top");
		expect(useStore.getState().barPosition).toBe("top");
		expect(localStorage.getItem("bar-position")).toBe("top");
	});

	it("toggleDarkMode flips and persists", () => {
		useStore.setState({ darkMode: false });
		useStore.getState().toggleDarkMode();
		expect(useStore.getState().darkMode).toBe(true);
		expect(localStorage.getItem("dark-mode")).toBe("true");
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it("togglePanel toggles active panel off when same", () => {
		useStore.getState().togglePanel("chartes");
		expect(useStore.getState().activePanel).toBe("chartes");
		useStore.getState().togglePanel("chartes");
		expect(useStore.getState().activePanel).toBeNull();
	});

	it("togglePanel switches to a different panel", () => {
		useStore.getState().togglePanel("chartes");
		useStore.getState().togglePanel("photos");
		expect(useStore.getState().activePanel).toBe("photos");
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

	it("defaults the cursor of a bound page to template mode, first row", () => {
		seed();
		expect(cursorForPage(useStore.getState(), "alpha", 0)).toEqual({
			docName: "alpha",
			pageIndex: 0,
			collection: "clients",
			mode: "template",
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
				mode: "template",
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
			"template",
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
