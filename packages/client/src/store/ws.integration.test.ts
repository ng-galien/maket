import type {
	WsCheckLayoutResponse,
	WsClientMessage,
	WsServerMessage,
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
	emit(msg: WsServerMessage) {
		this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
	}
	lastSent<T extends WsClientMessage>(): T {
		return JSON.parse(this.sent[this.sent.length - 1]) as T;
	}
	sentPayloads(): WsClientMessage[] {
		return this.sent.map((s) => JSON.parse(s) as WsClientMessage);
	}
}

function doc(name: string, charte?: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "flyer",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ name: "p1", elements: [] }],
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

// Re-import the store and ws module in isolation for each test so
// `let ws` / `initialStateReceived` / `pendingLoadDoc` inside ws.ts start fresh.
async function freshWsModule() {
	vi.resetModules();
	const store = await import("./useStore");
	const ws = await import("./ws");
	return { ...ws, useStore: store.useStore };
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
	it("opens a single socket per initWs call and sends workspace_update + sync_pending on open", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({
			workspaceDocNames: ["alpha", "beta"],
			pending: [{ id: "p1", type: "note", ts: 0 }],
		});
		initWs();
		initWs(); // second call is a no-op while ws exists
		expect(MockWebSocket.instances.length).toBe(1);

		MockWebSocket.last().open();

		const payloads = MockWebSocket.last().sentPayloads();
		expect(payloads).toHaveLength(2);
		expect(payloads[0]).toEqual({
			type: "workspace_update",
			displayed: ["alpha", "beta"],
		});
		expect(payloads[1]).toEqual({
			type: "sync_pending",
			pending: [{ id: "p1", type: "note", ts: 0 }],
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

describe("remove_doc", () => {
	it("removes the named doc from the workspace", async () => {
		const { initWs, useStore } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		useStore.getState().upsertDoc(doc("alpha"), [summary("alpha")], "");
		useStore
			.getState()
			.upsertDoc(doc("beta"), [summary("alpha"), summary("beta")], "");

		MockWebSocket.last().emit({ type: "remove_doc", name: "beta" });
		expect(useStore.getState().workspaceDocNames).toEqual(["alpha"]);
		expect(useStore.getState().docs.has("beta")).toBe(false);
	});
});

describe("check_layout_request", () => {
	it("responds with a check_layout_response when a page-canvas is present", async () => {
		const { initWs } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();

		// Install a minimal page-canvas the measurer can find.
		const page = document.createElement("div");
		page.className = "page-canvas";
		document.body.appendChild(page);
		vi.spyOn(page, "getBoundingClientRect").mockReturnValue({
			top: 0,
			left: 0,
			bottom: 200,
			right: 200,
			width: 200,
			height: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect);

		// Drain the onopen-driven sends before asserting on the response.
		MockWebSocket.last().sent.length = 0;

		MockWebSocket.last().emit({
			type: "check_layout_request",
			_reqId: "r-42",
			docName: "alpha",
			pageIdx: 0,
		});

		const payload = MockWebSocket.last().lastSent<WsCheckLayoutResponse>();
		expect(payload.type).toBe("check_layout_response");
		expect(payload._reqId).toBe("r-42");

		document.body.innerHTML = "";
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
