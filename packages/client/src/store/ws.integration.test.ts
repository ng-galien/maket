import type {
	Collection,
	WorkspaceCommand,
	WorkspaceSignal,
} from "@maket/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocSummary, Document } from "./types";

// --- MockWebSocket ------------------------------------------------------
// Minimal stand-in for the browser WebSocket. Each instance captures sent
// payloads and exposes helpers to drive onopen / onmessage / onclose from
// tests. Static `instances` lets tests grab the most recent connection.
class MockWebSocket {
	static instances: MockWebSocket[] = [];
	static last(): MockWebSocket {
		if (!MockWebSocket.instances.length) throw new Error("no ws instance");
		return MockWebSocket.instances[MockWebSocket.instances.length - 1];
	}

	url: string;
	readyState = 0;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((e: MessageEvent) => void) | null = null;

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}

	send(data: string) {
		if (this.readyState !== 1) throw new Error("send before open");
		this.sent.push(data);
	}

	close() {
		this.readyState = 3;
		this.onclose?.();
	}

	// Helpers
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	emit(msg: WorkspaceSignal) {
		this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
	}
	lastSent<T extends WorkspaceCommand>(): T {
		return JSON.parse(this.sent[this.sent.length - 1]) as T;
	}
	sentPayloads(): WorkspaceCommand[] {
		return this.sent.map((s) => JSON.parse(s) as WorkspaceCommand);
	}
}

function doc(name: string, charte?: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "flyer",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-page-1`, name: "p1", elements: [] }],
		activePage: 0,
		meta: charte ? { charte } : undefined,
	};
}

function summary(name: string): DocSummary {
	return {
		id: `id-${name}`,
		name,
		category: "flyer",
		format: "A4",
		pageCount: 1,
		elementCount: 0,
	};
}

const clientsCollection: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { client_name: { type: "string" } },
		required: ["client_name"],
	},
	members: [
		{
			id: "member_1",
			position: 0,
			data: { client_name: "Acme" },
		},
	],
};

// Re-import the store and ws module in isolation for each test so
// `let ws` / `initialStateReceived` / `pendingLoadDoc` inside ws.ts start fresh.
async function freshWsModule() {
	vi.resetModules();
	const store = await import("./useStore");
	const ws = await import("./ws");
	return { ...ws, useStore: store.useStore };
}

async function freshWsModuleWithZoomSpies() {
	vi.resetModules();
	const requestFit = vi.fn();
	vi.doMock("./zoomBridge", () => ({ requestFit }));
	const store = await import("./useStore");
	const ws = await import("./ws");
	return { ...ws, useStore: store.useStore, requestFit };
}

beforeEach(() => {
	MockWebSocket.instances.length = 0;
	vi.stubGlobal("WebSocket", MockWebSocket);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("initWs + onopen", () => {
	it("opens a single socket and reports only the displayed workspace", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ workspaceDocNames: ["alpha", "beta"] });
		initWs();
		initWs(); // second call is a no-op while ws exists
		expect(MockWebSocket.instances.length).toBe(1);

		MockWebSocket.last().open();

		const payloads = MockWebSocket.last().sentPayloads();
		expect(payloads).toHaveLength(1);
		expect(payloads[0]).toEqual({
			type: "workspace_update",
			displayed: ["alpha", "beta"],
		});
		expect(useStore.getState().connected).toBe(true);
	});

	it("onclose flips connected=false and schedules a reconnect", async () => {
		const { initWs, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		expect(useStore.getState().connected).toBe(true);

		MockWebSocket.last().close();
		expect(useStore.getState().connected).toBe(false);

		// reconnect is scheduled 2s later via setTimeout — advance fake timers
		expect(MockWebSocket.instances.length).toBe(1);
		vi.advanceTimersByTime(2000);
		expect(MockWebSocket.instances.length).toBe(2);
	});
});

describe("state message", () => {
	it("first state stores the doc without adding to workspace when the saved workspace is empty", async () => {
		const { initWs, useStore } = await freshWsModule();
		// Empty saved workspace — the client must NOT adopt the server's active
		// doc as focus; the user's persisted workspace is the source of truth.
		useStore.setState({ workspaceDocNames: [] });
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({
			type: "state",
			doc: doc("alpha"),
			docList: [summary("alpha")],
			charteCss: "/* c */",
		});

		const s = useStore.getState();
		expect(s.docs.has("alpha")).toBe(true);
		expect(s.workspaceDocNames).toEqual([]);
		expect(s.focusedDocName).toBeNull();
		expect(s.chartesCss.get("alpha")).toBe("/* c */");
	});

	it("first state re-focuses the doc when it matches the saved workspace", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ workspaceDocNames: ["alpha"] });
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({
			type: "state",
			doc: doc("alpha"),
			docList: [summary("alpha")],
			charteCss: "",
		});

		const s = useStore.getState();
		expect(s.focusedDocName).toBe("alpha");
		expect(s.workspaceDocNames).toEqual(["alpha"]);
	});

	it("first state issues load_document for every saved workspace doc other than the active one", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ workspaceDocNames: ["alpha", "beta", "gamma"] });
		initWs();
		MockWebSocket.last().open();
		// Drain onopen sends.
		MockWebSocket.last().sent.length = 0;

		MockWebSocket.last().emit({
			type: "state",
			doc: doc("alpha"),
			docList: [summary("alpha"), summary("beta"), summary("gamma")],
			charteCss: "",
		});

		const loads = MockWebSocket.last()
			.sentPayloads()
			.filter((p) => p.type === "load_document")
			.map((p) => (p as { name: string }).name);
		expect(loads).toEqual(["beta", "gamma"]);
	});

	it("subsequent state payloads respect addToWorkspace / focus flags", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ workspaceDocNames: ["alpha"] });
		initWs();
		MockWebSocket.last().open();
		// First state seeds the initialStateReceived latch.
		MockWebSocket.last().emit({
			type: "state",
			doc: doc("alpha"),
			docList: [summary("alpha")],
			charteCss: "",
		});
		// Second state — don't add to workspace, don't steal focus.
		MockWebSocket.last().emit({
			type: "state",
			doc: doc("beta"),
			docList: [summary("alpha"), summary("beta")],
			addToWorkspace: false,
			focus: false,
			charteCss: "",
		});
		const s = useStore.getState();
		expect(s.docs.has("beta")).toBe(true);
		expect(s.workspaceDocNames).toEqual(["alpha"]);
		expect(s.focusedDocName).toBe("alpha");
	});

	it("accepts a user-requested document focus while reading", async () => {
		const { initWs, sendLoadDoc, useStore } = await freshWsModule();
		useStore.setState({ workspaceDocNames: ["alpha"] });
		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().emit({
			type: "state",
			doc: doc("alpha"),
			docList: [summary("alpha"), summary("beta")],
			charteCss: "",
		});
		useStore.setState({ workspaceView: "reading" });

		sendLoadDoc("beta");
		MockWebSocket.last().emit({
			type: "state",
			doc: doc("beta"),
			docList: [summary("alpha"), summary("beta")],
			addToWorkspace: true,
			focus: true,
			charteCss: "",
		});

		expect(useStore.getState().focusedDocName).toBe("beta");
	});

	it("does not treat workspace restoration as an explicit user focus", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ workspaceDocNames: ["alpha", "beta"] });
		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().emit({
			type: "state",
			doc: doc("alpha"),
			docList: [summary("alpha"), summary("beta")],
			charteCss: "",
		});

		MockWebSocket.last().emit({
			type: "state",
			doc: doc("beta"),
			docList: [summary("alpha"), summary("beta")],
			addToWorkspace: true,
			focus: true,
			charteCss: "",
		});

		expect(useStore.getState().focusedDocName).toBe("alpha");
	});

	it("null doc payload updates docList only", async () => {
		const { initWs, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().emit({
			type: "state",
			doc: null,
			docList: [summary("alpha"), summary("beta")],
			charteCss: "",
		});
		const s = useStore.getState();
		expect(s.docList).toHaveLength(2);
		expect(s.docs.size).toBe(0);
	});

	it("adds the first created doc after an initial empty state", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ workspaceDocNames: [], focusedDocName: null });
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({
			type: "state",
			doc: null,
			docList: [],
			charteCss: "",
		});
		MockWebSocket.last().emit({
			type: "state",
			doc: doc("created"),
			docList: [summary("created")],
			charteCss: "",
			addToWorkspace: true,
		});

		const s = useStore.getState();
		expect(s.workspaceDocNames).toEqual(["created"]);
		expect(s.focusedDocName).toBe("created");
	});

	it("preserves collections when a layout state refresh omits them", async () => {
		const { initWs, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({
			type: "state",
			doc: doc("alpha"),
			docList: [summary("alpha")],
			collections: [clientsCollection],
			charteCss: "",
		});
		MockWebSocket.last().emit({
			type: "state",
			doc: doc("alpha"),
			docList: [summary("alpha")],
			charteCss: "",
		});

		expect(useStore.getState().collections).toEqual([clientsCollection]);
	});
});

describe("living document state signals", () => {
	it("stores the state view and applies targeted page projections", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ workspaceDocNames: ["checklist"] });
		initWs();
		MockWebSocket.last().open();
		const living = {
			...doc("checklist"),
			dataModel: "state" as const,
			pages: [
				{ id: "checklist-page-1", name: "p1", elements: [], html: "Before" },
				{ id: "checklist-page-2", name: "p2", elements: [], html: "Stable" },
			],
		};
		const firstView = {
			schema: { type: "object" },
			data: { title: "Before" },
			revision: 1,
			createdAt: "2026-08-04T12:00:00.000Z",
			templates: { "checklist-page-1": "{{ state.title }}" },
		};
		MockWebSocket.last().emit({
			type: "state",
			doc: living,
			docList: [summary("checklist")],
			charteCss: "",
			documentState: firstView,
		});
		expect(useStore.getState().documentStates.checklist).toEqual(firstView);

		const nextView = { ...firstView, data: { title: "After" }, revision: 2 };
		MockWebSocket.last().emit({
			type: "state_pages",
			docName: "checklist",
			documentState: nextView,
			pages: [{ index: 0, html: "After" }],
			docList: [summary("checklist")],
		});
		const next = useStore.getState();
		expect(next.docs.get("checklist")?.pages.map((page) => page.html)).toEqual([
			"After",
			"Stable",
		]);
		expect(next.documentStates.checklist.revision).toBe(2);
	});

	it("sends a terminal replace and clears its pending marker on acknowledgement", async () => {
		const { initWs, sendStateValuePatch, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().sent.length = 0;

		const requestId = sendStateValuePatch("checklist", "/done", 3, true);
		if (!requestId) throw new Error("State patch was not sent.");
		const command = MockWebSocket.last().lastSent();
		expect(command).toEqual({
			type: "state_patch",
			requestId,
			docName: "checklist",
			expectedRevision: 3,
			operation: { op: "replace", path: "/done", value: true },
		});
		expect(Object.values(useStore.getState().statePatchPending)).toContain(
			requestId,
		);

		MockWebSocket.last().emit({
			type: "state_patch_result",
			requestId,
			ok: true,
			revision: 4,
		});
		expect(useStore.getState().statePatchPending).toEqual({});
	});

	it("serializes terminal patches across different paths of one document", async () => {
		const { initWs, sendStateValuePatch } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().sent.length = 0;

		const first = sendStateValuePatch("checklist", "/title", 3, "Opening");
		const second = sendStateValuePatch("checklist", "/status", 3, "done");

		expect(first).not.toBeNull();
		expect(second).toBeNull();
		expect(MockWebSocket.last().sentPayloads()).toHaveLength(1);
		expect(MockWebSocket.last().lastSent()).toMatchObject({
			type: "state_patch",
			operation: { path: "/title" },
		});
	});

	it("clears a timeout error when the correlated success arrives late", async () => {
		const { initWs, sendStateValuePatch, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		const requestId = sendStateValuePatch("checklist", "/done", 3, true);
		if (!requestId) throw new Error("State patch was not sent.");

		vi.advanceTimersByTime(10_000);
		expect(useStore.getState().statePatchPending).toEqual({});
		expect(Object.values(useStore.getState().statePatchErrors)).toEqual([
			"State update timed out.",
		]);

		MockWebSocket.last().emit({
			type: "state_patch_result",
			requestId,
			ok: true,
			revision: 4,
		});
		expect(useStore.getState().statePatchErrors).toEqual({});
		expect(useStore.getState().statePatchRequests).toEqual({});
	});

	it("does not mark an unsent state patch and clears pending patches on close", async () => {
		const { initWs, sendStateValuePatch, useStore } = await freshWsModule();
		initWs();

		expect(sendStateValuePatch("checklist", "/done", 3, true)).toBeNull();
		expect(useStore.getState().statePatchPending).toEqual({});
		expect(Object.values(useStore.getState().statePatchErrors)).toEqual([
			"State update could not be sent.",
		]);

		MockWebSocket.last().open();
		const requestId = sendStateValuePatch("checklist", "/done", 3, true);
		expect(requestId).not.toBeNull();
		expect(useStore.getState().statePatchPending).not.toEqual({});
		MockWebSocket.last().close();
		expect(useStore.getState().statePatchPending).toEqual({});
	});

	it("keeps a failed state patch visible after pending settles", async () => {
		const { initWs, sendStateValuePatch, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		const requestId = sendStateValuePatch("checklist", "/done", 3, true);
		if (!requestId) throw new Error("State patch was not sent.");

		MockWebSocket.last().emit({
			type: "state_patch_result",
			requestId,
			ok: false,
			error: "Revision conflict",
		});

		expect(useStore.getState().statePatchPending).toEqual({});
		expect(Object.values(useStore.getState().statePatchErrors)).toEqual([
			"Revision conflict",
		]);
	});
});

describe("charte_updated", () => {
	it("propagates the new CSS to every doc referencing that charte", async () => {
		const { initWs, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();

		// Seed two docs with the same charte, one with a different one.
		useStore.getState().upsertDoc(doc("a", "brand-x"), [summary("a")], "OLD");
		useStore
			.getState()
			.upsertDoc(doc("b", "brand-x"), [summary("a"), summary("b")], "OLD");
		useStore
			.getState()
			.upsertDoc(
				doc("c", "brand-y"),
				[summary("a"), summary("b"), summary("c")],
				"KEEP",
			);
		const before = useStore.getState().chartesVersion;

		MockWebSocket.last().emit({
			type: "charte_updated",
			name: "brand-x",
			css: "NEW",
		});

		const s = useStore.getState();
		expect(s.chartesCss.get("a")).toBe("NEW");
		expect(s.chartesCss.get("b")).toBe("NEW");
		expect(s.chartesCss.get("c")).toBe("KEEP");
		expect(s.chartesVersion).toBe(before + 1);
	});
});

describe("ack_messages", () => {
	it("drops pending entries matching the ack ids", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({
			pending: [
				{ id: "m1", type: "note", ts: 0 },
				{ id: "m2", type: "note", ts: 0 },
				{ id: "m3", type: "note", ts: 0 },
			],
		});
		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().emit({
			type: "ack_messages",
			ids: ["m1", "m3"],
		});
		expect(useStore.getState().pending.map((m) => m.id)).toEqual(["m2"]);
	});

	it("is a no-op when no ids match", async () => {
		const { initWs, useStore } = await freshWsModule();
		const pending = [{ id: "m1", type: "note" as const, ts: 0 }];
		useStore.setState({ pending });
		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().emit({
			type: "ack_messages",
			ids: ["nope"],
		});
		expect(useStore.getState().pending).toBe(pending);
	});
});

describe("annotation_create acknowledgement", () => {
	it("settles the matching creation only after the server confirms persistence", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ focusedDocName: "brief" });
		initWs();
		const socket = MockWebSocket.last();
		socket.open();

		const outcomePromise = useStore.getState().addPending({
			id: "note-1",
			type: "note",
			text: "Keep until confirmed",
			ts: 1,
		});
		const command =
			socket.lastSent<
				Extract<WorkspaceCommand, { type: "annotation_create" }>
			>();
		expect(command).toMatchObject({
			type: "annotation_create",
			annotation: {
				id: "note-1",
				docName: "brief",
				text: "Keep until confirmed",
			},
		});

		socket.emit({
			type: "annotation_create_result",
			requestId: command.requestId,
			ok: true,
		});
		await expect(outcomePromise).resolves.toEqual({ ok: true });
	});

	it("returns the correlated server refusal without mutating the annotation list", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ focusedDocName: "deleted", pending: [] });
		initWs();
		const socket = MockWebSocket.last();
		socket.open();

		const outcomePromise = useStore.getState().addPending({
			id: "note-rejected",
			type: "note",
			text: "Do not lose me",
			ts: 2,
		});
		const command =
			socket.lastSent<
				Extract<WorkspaceCommand, { type: "annotation_create" }>
			>();
		socket.emit({
			type: "annotation_create_result",
			requestId: command.requestId,
			ok: false,
			error: 'Document "deleted" not found',
		});

		await expect(outcomePromise).resolves.toEqual({
			ok: false,
			error: 'Document "deleted" not found',
		});
		expect(useStore.getState().pending).toEqual([]);
	});

	it("reports a persistence timeout when the server never acknowledges", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ focusedDocName: "brief" });
		initWs();
		MockWebSocket.last().open();

		const outcome = useStore.getState().addPending({
			id: "note-timeout",
			type: "note",
			text: "Keep this draft",
			ts: 3,
		});
		await vi.advanceTimersByTimeAsync(10_000);

		await expect(outcome).resolves.toEqual({
			ok: false,
			error: "The note could not be confirmed by the server.",
		});
	});

	it("settles an in-flight creation when the connection closes", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ focusedDocName: "brief" });
		initWs();
		const socket = MockWebSocket.last();
		socket.open();

		const outcome = useStore.getState().addPending({
			id: "note-disconnected",
			type: "note",
			text: "Keep this too",
			ts: 4,
		});
		socket.close();

		await expect(outcome).resolves.toEqual({
			ok: false,
			error: "The connection closed before the note was saved.",
		});
	});
});

describe("workspace command wire format", () => {
	it("serializes the public document authoring commands", async () => {
		const {
			initWs,
			sendDeleteDoc,
			sendDuplicateDoc,
			sendLockDoc,
			sendRenameDoc,
			sendTextEdit,
		} = await freshWsModule();
		initWs();
		const socket = MockWebSocket.last();
		socket.open();
		socket.sent.length = 0;

		sendTextEdit("poster", 1, "title", "<strong>Ready</strong>");
		sendDeleteDoc("obsolete");
		sendRenameDoc("draft", "final");
		sendDuplicateDoc("final", "variant");
		sendLockDoc("final", true);

		expect(socket.sentPayloads()).toEqual([
			{
				type: "text_edit",
				docName: "poster",
				pageIndex: 1,
				elementId: "title",
				html: "<strong>Ready</strong>",
			},
			{ type: "delete_document", name: "obsolete" },
			{ type: "rename_document", name: "draft", newName: "final" },
			{ type: "duplicate_document", name: "final", newName: "variant" },
			{ type: "lock_document", name: "final", locked: true },
		]);
	});

	it("logs an unknown future signal without throwing", async () => {
		const { initWs } = await freshWsModule();
		initWs();
		const socket = MockWebSocket.last();
		socket.open();
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(() =>
			socket.emit({ type: "future_signal" } as unknown as WorkspaceSignal),
		).not.toThrow();
		expect(error).toHaveBeenCalledWith("[ws] unhandled server signal", {
			type: "future_signal",
		});
	});
});

describe("doc_renamed", () => {
	it("atomically replaces the open identity and preserves local focus", async () => {
		const { initWs, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		useStore.setState({
			docs: new Map([
				["old", doc("old")],
				["other", doc("other")],
			]),
			workspaceDocNames: ["old", "other"],
			focusedDocName: "old",
			focusedPageIndex: 0,
		});

		MockWebSocket.last().emit({
			type: "doc_renamed",
			oldName: "old",
			doc: doc("renamed"),
			docList: [summary("renamed"), summary("other")],
			annotations: [
				{
					id: "note-1",
					docName: "renamed",
					type: "note",
					text: "Keep me",
				},
			],
			charteCss: "/* renamed */",
		});

		const state = useStore.getState();
		expect(state.workspaceDocNames).toEqual(["renamed", "other"]);
		expect(state.docs.has("old")).toBe(false);
		expect(state.docs.has("renamed")).toBe(true);
		expect(state.focusedDocName).toBe("renamed");
		expect(state.pending).toEqual([
			expect.objectContaining({ id: "note-1", docName: "renamed" }),
		]);
	});
});

describe("doc_removed", () => {
	it("removes the named doc from the workspace", async () => {
		const { initWs, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		useStore.getState().upsertDoc(doc("alpha"), [summary("alpha")], "");
		useStore
			.getState()
			.upsertDoc(doc("beta"), [summary("alpha"), summary("beta")], "");

		MockWebSocket.last().emit({ type: "doc_removed", name: "beta" });
		expect(useStore.getState().workspaceDocNames).toEqual(["alpha"]);
		expect(useStore.getState().docs.has("beta")).toBe(false);
		expect(useStore.getState().docList.map((doc) => doc.name)).toEqual([
			"alpha",
		]);
	});

	it("removes a closed document from the library without changing the workspace", async () => {
		const { initWs, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		useStore.getState().upsertDoc(doc("alpha"), [summary("alpha")], "");
		useStore.setState({ docList: [summary("alpha"), summary("beta")] });

		MockWebSocket.last().emit({ type: "doc_removed", name: "beta" });

		expect(useStore.getState().workspaceDocNames).toEqual(["alpha"]);
		expect(useStore.getState().focusedDocName).toBe("alpha");
		expect(useStore.getState().docList.map((doc) => doc.name)).toEqual([
			"alpha",
		]);
	});
});

describe("assets_changed", () => {
	it("dispatches a window `assets-changed` event", async () => {
		const { initWs } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();

		const listener = vi.fn();
		window.addEventListener("assets-changed", listener);
		MockWebSocket.last().emit({ type: "assets_changed" });
		window.removeEventListener("assets-changed", listener);
		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("activity", () => {
	it("renders a translated activity bubble in the DOM", async () => {
		localStorage.setItem("maket-lang", "fr");
		const { initWs } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({
			type: "activity",
			key: "bubble_maket_html_set",
			params: { count: "2" },
			icon: "file-pen",
		});

		expect(document.body.textContent).toContain("Page composée");
		expect(document.body.textContent).toContain("2 éléments");
		expect(document.querySelector("[data-maket-activity]")).not.toBeNull();
		expect(document.querySelector("svg")).not.toBeNull();

		document.body.innerHTML = "";
	});

	it("keeps agent activity bubbles out of the reading surface", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({ workspaceView: "reading" });
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({
			type: "activity",
			key: "bubble_maket_html_patch",
			params: {},
			icon: "file-pen",
		});

		expect(document.querySelector("[data-maket-activity]")).toBeNull();
	});

	it("renders server-authored toasts through their dedicated UI path", async () => {
		const { initWs } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({
			type: "toast",
			text: "Saved",
			level: "success",
			duration: 3000,
		});

		const toast = document.querySelector('[role="status"]');
		expect(toast?.textContent).toBe("Saved");
		expect(document.getElementById("maket-toast-region")).not.toBeNull();
		document.getElementById("maket-toast-region")?.remove();
	});
});

describe("fit_view", () => {
	it("delegates to the deferred fit while the canvas is visible", async () => {
		const { initWs, requestFit, useStore } = await freshWsModuleWithZoomSpies();
		useStore.setState({ workspaceView: "canvas" });
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({ type: "fit_view" });

		expect(requestFit).toHaveBeenCalledExactlyOnceWith();
	});

	it("does not queue a background fit while reading", async () => {
		const { initWs, requestFit, useStore } = await freshWsModuleWithZoomSpies();
		useStore.setState({ workspaceView: "reading" });
		initWs();
		MockWebSocket.last().open();

		MockWebSocket.last().emit({ type: "fit_view" });

		expect(requestFit).not.toHaveBeenCalled();
	});
});
