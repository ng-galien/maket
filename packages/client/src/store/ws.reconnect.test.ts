import type { WorkspaceCommand, WorkspaceSignal } from "@maket/shared";
import { DEFAULT_SETTINGS } from "@maket/shared";
import { act, renderHook } from "@testing-library/react";
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

function summary(name: string, id = `id-${name}`): DocSummary {
	return {
		id,
		name,
		category: "flyer",
		format: "A4",
		pageCount: 1,
		elementCount: 0,
		collectionBindings: [],
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

function twoPages(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "flyer",
		canvas: { w: 210, h: 297, background: "#fff" },
		activePage: 0,
		pages: [
			{ id: `${name}-page-1`, name: "p1", elements: [] },
			{ id: `${name}-page-2`, name: "p2", elements: [] },
			{ id: `${name}-page-3`, name: "p3", elements: [] },
		],
	};
}

const docList = [summary("alpha"), summary("beta")];
const settingsSignal: WorkspaceSignal = {
	type: "settings",
	settings: DEFAULT_SETTINGS,
};

function connectionState(doc: Document | null): WorkspaceSignal {
	return { type: "state", doc, docList, charteCss: "", addToWorkspace: true };
}

function loadedState(name: string, list = docList): WorkspaceSignal {
	return {
		type: "state",
		doc: twoPages(name),
		docList: list,
		charteCss: "",
		addToWorkspace: true,
		focus: true,
	};
}

function sentTypes(socket: MockWebSocket): string[] {
	return socket.sentPayloads().map((payload) => payload.type);
}

function setVisibility(state: DocumentVisibilityState): void {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => state,
	});
}

/** A connected mobile reader with alpha and beta loaded, reading beta page 3. */
async function readingBeta() {
	const modules = await freshWsModule();
	const { initWs, useStore } = modules;
	useStore.setState({
		workspaceDocNames: ["alpha", "beta"],
		focusedDocName: "beta",
		workspaceView: "canvas",
		mobileReading: true,
	});
	initWs();
	MockWebSocket.last().open();
	MockWebSocket.last().emit(connectionState(null));
	MockWebSocket.last().emit(settingsSignal);
	MockWebSocket.last().emit(loadedState("alpha"));
	MockWebSocket.last().emit(loadedState("beta"));
	useStore.getState().setFocusedPage("beta", 2);
	return modules;
}

// This describe runs first: older module copies of later tests would also
// listen to the page events dispatched here.
describe("connection check", () => {
	it("checks the connection when the page shows again or the network returns, and replaces a silent socket", async () => {
		const { useStore } = await readingBeta();
		const first = MockWebSocket.last();
		first.sent.length = 0;

		setVisibility("visible");
		document.dispatchEvent(new Event("visibilitychange"));
		expect(sentTypes(first)).toEqual(["connection_check"]);
		window.dispatchEvent(new Event("pageshow"));
		window.dispatchEvent(new Event("online"));
		expect(sentTypes(first)).toEqual(["connection_check"]);
		expect(useStore.getState().connected).toBe(true);

		vi.advanceTimersByTime(3000);
		expect(useStore.getState().connected).toBe(false);
		vi.advanceTimersByTime(1);
		expect(MockWebSocket.instances).toHaveLength(2);
		expect(first.onclose).toBeNull();

		MockWebSocket.last().open();
		expect(useStore.getState().connected).toBe(true);
		MockWebSocket.last().emit(connectionState(null));
		MockWebSocket.last().emit(settingsSignal);
		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedPageIndex).toBe(2);
	});

	it("keeps a socket that answers the check", async () => {
		const { checkConnection, useStore } = await readingBeta();
		checkConnection();
		const check = MockWebSocket.last().lastSent<{
			type: "connection_check";
			requestId: string;
		}>();
		MockWebSocket.last().emit({
			type: "connection_checked",
			requestId: check.requestId,
		});
		vi.advanceTimersByTime(10_000);

		expect(MockWebSocket.instances).toHaveLength(1);
		expect(useStore.getState().connected).toBe(true);
	});

	it("reconnects at once when the page shows again without a socket", async () => {
		const { checkConnection, useStore } = await readingBeta();
		MockWebSocket.last().close();
		expect(useStore.getState().connected).toBe(false);

		checkConnection();

		expect(MockWebSocket.instances).toHaveLength(2);
		vi.advanceTimersByTime(2000);
		expect(MockWebSocket.instances).toHaveLength(2);
	});

	it("leaves the linked reader's connection as it is", async () => {
		vi.stubGlobal("location", {
			protocol: "http:",
			host: "localhost",
			pathname: "/documents/doc-1/read",
		});
		const { initWs } = await freshWsModule();
		initWs();
		MockWebSocket.last().open();
		setVisibility("visible");
		document.dispatchEvent(new Event("visibilitychange"));
		expect(MockWebSocket.last().sent).toEqual([]);

		MockWebSocket.last().close();
		document.dispatchEvent(new Event("visibilitychange"));
		expect(MockWebSocket.instances).toHaveLength(1);
	});
});

describe("reconnection keeps the client's reading state", () => {
	it("opens the saved focused document on the first connection, not the server's first document", async () => {
		const { initWs, useStore } = await freshWsModule();
		useStore.setState({
			workspaceDocNames: ["alpha", "beta"],
			focusedDocName: "beta",
			workspaceView: "canvas",
			mobileReading: true,
		});
		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().emit(connectionState(twoPages("alpha")));

		expect(useStore.getState().focusedDocName).toBe("beta");
	});

	it("keeps the document and page being read when the server sends its initial state again", async () => {
		const { useStore } = await readingBeta();
		expect(useStore.getState().focusedPageIndex).toBe(2);

		MockWebSocket.last().close();
		vi.advanceTimersByTime(2000);
		MockWebSocket.last().open();
		MockWebSocket.last().emit(connectionState(twoPages("alpha")));
		MockWebSocket.last().emit(settingsSignal);
		MockWebSocket.last().emit(loadedState("beta"));

		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedPageIndex).toBe(2);
	});

	it("reopens the remembered document at the remembered page and offset on a cold start", async () => {
		localStorage.setItem("maket-workspace", JSON.stringify(["alpha", "beta"]));
		localStorage.setItem("maket-focused-doc", "beta");
		localStorage.setItem(
			"maket-reading-position",
			JSON.stringify({ docName: "beta", pageIndex: 2, offset: 0.4 }),
		);
		const { initWs, useStore } = await freshWsModule();
		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedPageIndex).toBe(2);

		initWs();
		MockWebSocket.last().open();
		MockWebSocket.last().emit(connectionState(null));
		MockWebSocket.last().emit(settingsSignal);
		MockWebSocket.last().emit(loadedState("alpha"));
		MockWebSocket.last().emit(loadedState("beta"));

		const state = useStore.getState();
		expect(state.focusedDocName).toBe("beta");
		expect(state.focusedPageIndex).toBe(2);
		expect(state.readingPosition).toEqual({
			docName: "beta",
			pageIndex: 2,
			offset: 0.4,
		});
	});

	it("remembers the page and the offset being read", async () => {
		const { useStore } = await readingBeta();
		useStore.getState().setReadingOffset("beta", 2, 0.25);
		useStore.getState().setReadingOffset("beta", 1, 0.9);

		expect(
			JSON.parse(localStorage.getItem("maket-reading-position") ?? "null"),
		).toEqual({ docName: "beta", pageIndex: 2, offset: 0.25 });

		useStore.getState().setFocusedPage("beta", 1);
		expect(useStore.getState().readingPosition).toEqual({
			docName: "beta",
			pageIndex: 1,
			offset: 0,
		});
	});
});

describe("cold start with the mobile navigation history", () => {
	it("puts the catalogue beneath the restored reading, so Back leads to it", async () => {
		localStorage.setItem("maket-workspace", JSON.stringify(["alpha", "beta"]));
		localStorage.setItem("maket-focused-doc", "beta");
		localStorage.setItem("maket-library-open", "false");
		localStorage.setItem(
			"maket-reading-position",
			JSON.stringify({ docName: "beta", pageIndex: 2, offset: 0.4 }),
		);
		history.replaceState(null, "");
		const { initWs, useStore } = await freshWsModule();
		const { useMobileNavigation } = await import("../lib/useMobileNavigation");
		useStore.setState({ mobileReading: true });
		renderHook(() => useMobileNavigation(true));
		initWs();
		act(() => {
			MockWebSocket.last().open();
			MockWebSocket.last().emit(connectionState(null));
			MockWebSocket.last().emit(settingsSignal);
			MockWebSocket.last().emit(loadedState("alpha"));
			MockWebSocket.last().emit(loadedState("beta"));
		});
		const reading = history.state?.maketMobileNavigation;
		expect(reading.index).toBe(1);
		expect(reading.snapshot.shell.focusedDocName).toBe("beta");
		expect(reading.snapshot.shell.libraryOpen).toBe(false);

		vi.useRealTimers();
		history.back();
		await vi.waitFor(() => expect(useStore.getState().libraryOpen).toBe(true));
		expect(history.state.maketMobileNavigation.index).toBe(0);
		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(useStore.getState().focusedPageIndex).toBe(2);
	});
});

describe("reconnection with the mobile navigation history installed", () => {
	async function mobileReader() {
		const modules = await freshWsModule();
		const { useMobileNavigation } = await import("../lib/useMobileNavigation");
		const { beginMobileNavigation } = await import("../lib/mobileHistory");
		const { initWs, useStore } = modules;
		history.replaceState(null, "");
		useStore.setState({
			workspaceDocNames: ["alpha", "beta"],
			focusedDocName: "alpha",
			workspaceView: "canvas",
			mobileReading: true,
			libraryOpen: false,
			settingsOpen: false,
		});
		renderHook(() => useMobileNavigation(true));
		initWs();
		act(() => {
			MockWebSocket.last().open();
			MockWebSocket.last().emit(connectionState(null));
			MockWebSocket.last().emit(settingsSignal);
			MockWebSocket.last().emit(loadedState("alpha"));
			MockWebSocket.last().emit(loadedState("beta"));
		});
		const alphaEntry = history.state;
		act(() => {
			beginMobileNavigation({ focusedDocName: "beta" });
			useStore.getState().setFocusedDoc("beta");
			vi.runOnlyPendingTimers();
		});
		act(() => {
			useStore.getState().setFocusedPage("beta", 2);
			vi.runOnlyPendingTimers();
		});
		return { ...modules, alphaEntry };
	}

	function entryIndex(): number {
		return history.state?.maketMobileNavigation?.index;
	}

	it("returns to the document and page being read, whatever the order of state and settings", async () => {
		const { useStore } = await mobileReader();
		// Catalogue, then alpha, then beta.
		expect(entryIndex()).toBe(2);
		const observed: Record<string, [string | null, number, number]> = {};
		for (const order of ["state-then-settings", "settings-then-state"]) {
			act(() => {
				MockWebSocket.last().close();
				vi.advanceTimersByTime(2000);
			});
			const initial = connectionState(twoPages("alpha"));
			const [first, second] =
				order === "state-then-settings"
					? [initial, settingsSignal]
					: [settingsSignal, initial];
			act(() => MockWebSocket.last().open());
			act(() => MockWebSocket.last().emit(first));
			act(() => MockWebSocket.last().emit(second));
			act(() => {
				vi.runOnlyPendingTimers();
			});
			const s = useStore.getState();
			observed[order] = [s.focusedDocName, s.focusedPageIndex, entryIndex()];
		}
		expect(observed).toEqual({
			"state-then-settings": ["beta", 2, 2],
			"settings-then-state": ["beta", 2, 2],
		});
	});

	it("goes back to a document renamed while the connection was lost", async () => {
		const { useStore, alphaEntry } = await mobileReader();
		act(() => {
			MockWebSocket.last().close();
			vi.advanceTimersByTime(2000);
		});
		const renamedList = [summary("alpha renamed", "id-alpha"), summary("beta")];
		act(() => {
			MockWebSocket.last().open();
			MockWebSocket.last().emit({
				type: "state",
				doc: null,
				docList: renamedList,
				charteCss: "",
				addToWorkspace: true,
			});
			MockWebSocket.last().emit(settingsSignal);
		});

		act(() => {
			window.dispatchEvent(
				new PopStateEvent("popstate", { state: alphaEntry }),
			);
		});

		const state = useStore.getState();
		expect(state.focusedDocName).toBe("alpha renamed");
		expect(state.workspaceDocNames).toContain("alpha renamed");
	});
});
