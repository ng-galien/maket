import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocSummary, Document } from "./types";

// Silence the syncPending/syncWorkspace setTimeout → wsSend(null) no-op chatter.
// Must be hoisted above the useStore import so the mocked wsSend is bound at
// module init time.
vi.mock("./ws", async () => {
	const actual = await vi.importActual<typeof import("./ws")>("./ws");
	return { ...actual, wsSend: vi.fn() };
});

const { useStore } = await import("./useStore");

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
			docList: [],
			chartesCss: new Map(),
			chartesVersion: 0,
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

function makeDoc(name: string, category = "flyer"): Document {
	return {
		id: `id-${name}`,
		name,
		category,
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ name: "p1", elements: [] }],
		activePage: 0,
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
		const b = makeDoc("beta");
		useStore.getState().upsertDoc(a, [summary("alpha")], "");
		useStore
			.getState()
			.upsertDoc(b, [summary("alpha"), summary("beta")], "", true, true);
		expect(useStore.getState().focusedDocName).toBe("beta");
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
		expect(useStore.getState().focusedDocName).toBe("beta");
		useStore.getState().removeDocFromWorkspace("beta");
		const s = useStore.getState();
		expect(s.workspaceDocNames).toEqual(["alpha"]);
		expect(s.focusedDocName).toBe("alpha");
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
		useStore.setState({ focusedDocName: "alpha", selectedIds: ["x"] });
		useStore.getState().setFocusedDoc("beta");
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
