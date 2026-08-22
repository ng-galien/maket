import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { AppShell } from "./AppShell";

vi.mock("./Board", () => ({ Board: () => null }));
vi.mock("./CollectionWorkspace", () => ({
	CollectionWorkspace: () => null,
	selectCollectionWorkspaceLayout: () => "closed",
}));
vi.mock("./LibraryPanel", () => ({
	LibraryPanel: () => <aside data-library-panel />,
}));
vi.mock("./Popover", () => ({ Popover: () => null }));
vi.mock("./SettingsPage", () => ({
	SettingsPage: () => <main data-settings-page />,
}));
vi.mock("./WorkspaceHeader", () => ({
	WorkspaceHeader: () => <header data-workspace-header />,
}));

beforeEach(() => {
	class ResizeObserverMock {
		observe() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);
	setLang("en");
	useStore.setState({
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		focusedCollectionName: null,
		docList: [],
		collections: [],
		pending: [],
		libraryOpen: true,
		libraryView: "docs",
		settingsOpen: false,
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	cleanup();
	vi.restoreAllMocks();
});

describe("AppShell interaction contract", () => {
	it("keeps one global header above every workspace region", () => {
		const { container } = render(<AppShell locked={false} />);
		const shell = container.querySelector("[data-app-shell]");
		const header = container.querySelector("[data-workspace-header]");
		const workarea = container.querySelector("[data-shell-workarea]");
		expect(shell?.firstElementChild).toBe(header);
		expect(workarea?.querySelector("[data-library-panel]")).toBeTruthy();
	});

	it("closes the last active panel with Escape and restores canvas focus", async () => {
		const { container } = render(<AppShell locked={false} />);
		fireEvent.keyDown(window, { key: "Escape" });

		await waitFor(() => expect(useStore.getState().libraryOpen).toBe(false));
		await waitFor(() =>
			expect(container.querySelector("[data-canvas-workspace]")).toHaveFocus(),
		);
	});

	it("keeps a single navigation surface beside the workspace", () => {
		const { container } = render(<AppShell locked={false} />);
		expect(container.querySelectorAll("[data-library-panel]")).toHaveLength(1);
		expect(container.querySelector("[data-utility-rail]")).toBeNull();
	});

	it("replaces the workspace with the full settings page", () => {
		useStore.setState({ settingsOpen: true, libraryOpen: false });
		const { container } = render(<AppShell locked={false} />);

		expect(container.querySelector("[data-settings-page]")).toBeTruthy();
		expect(container.querySelector("[data-canvas-workspace]")).toBeNull();
	});
});
