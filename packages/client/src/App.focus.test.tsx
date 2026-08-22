import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "./store/types";
import { useStore } from "./store/useStore";

vi.mock("./components/AppShell", () => ({
	AppShell: () => <main data-app-shell />,
}));
vi.mock("./components/ReadingWorkspace", () => ({
	ReadingWorkspace: () => <main data-reading-workspace />,
}));
vi.mock("./desktopCommands", () => ({
	installDesktopCommands: () => () => undefined,
}));
vi.mock("./lib/colorScheme", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./lib/colorScheme")>();
	return {
		...actual,
		applyAccentColor: vi.fn(),
		applyColorScheme: vi.fn(),
	};
});
vi.mock("./store/ws", async () => {
	const actual =
		await vi.importActual<typeof import("./store/ws")>("./store/ws");
	return { ...actual, initWs: vi.fn() };
});

const { default: App } = await import("./App");

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "test",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-page`, name: "Page", elements: [] }],
		activePage: 0,
	};
}

beforeEach(() => {
	useStore.setState({
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		workspaceView: "canvas",
		darkMode: false,
	});
});

afterEach(() => cleanup());

describe("workspace focus invariant", () => {
	it("repairs a focus that no longer belongs to the open workspace", async () => {
		render(<App />);

		act(() => {
			useStore.setState({
				docs: new Map([["alpha", makeDoc("alpha")]]),
				workspaceDocNames: ["alpha"],
				focusedDocName: "closed-beta",
			});
		});

		await waitFor(() =>
			expect(useStore.getState().focusedDocName).toBe("alpha"),
		);
	});

	it("prefers a loaded document over a restored placeholder", async () => {
		render(<App />);

		act(() => {
			useStore.setState({
				docs: new Map([["alpha", makeDoc("alpha")]]),
				workspaceDocNames: ["alpha", "unloaded-beta"],
				focusedDocName: "unloaded-beta",
			});
		});

		await waitFor(() =>
			expect(useStore.getState().focusedDocName).toBe("alpha"),
		);
	});

	it("clears a stale focus when the workspace becomes empty", async () => {
		render(<App />);

		act(() => {
			useStore.setState({
				workspaceDocNames: [],
				focusedDocName: "closed-beta",
			});
		});

		await waitFor(() => expect(useStore.getState().focusedDocName).toBeNull());
	});
});
