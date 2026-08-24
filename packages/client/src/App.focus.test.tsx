import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "./store/types";
import { useStore } from "./store/useStore";

const appMocks = vi.hoisted(() => ({
	configuration: {
		status: "ready",
		plan: null,
		error: undefined,
	} as {
		status: "idle" | "loading" | "ready" | "applying" | "error";
		plan: null | Record<string, unknown>;
		error?: string;
	},
	refreshConfiguration: vi.fn(async () => true),
}));

vi.mock("./components/AppShell", () => ({
	AppShell: () => <main data-app-shell />,
}));
vi.mock("./components/DesktopOnboarding", () => ({
	DesktopOnboarding: () => <main data-desktop-onboarding />,
}));
vi.mock("./components/ReadingWorkspace", () => ({
	ReadingWorkspace: () => <main data-reading-workspace />,
}));
vi.mock("./desktopCommands", () => ({
	installDesktopCommands: () => () => undefined,
}));
vi.mock("./desktopConfiguration", () => ({
	initializeDesktopConfiguration: () => () => undefined,
	refreshDesktopConfiguration: appMocks.refreshConfiguration,
	useDesktopConfiguration: () => appMocks.configuration,
}));
vi.mock("./desktopUpdates", () => ({
	initializeDesktopUpdates: () => () => undefined,
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
	appMocks.configuration = { status: "ready", plan: null };
	appMocks.refreshConfiguration.mockClear();
	delete window.maketDesktop;
	useStore.setState({
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		workspaceView: "canvas",
		workspaceHydrated: false,
		darkMode: false,
	});
});

afterEach(() => {
	delete window.maketDesktop;
	cleanup();
});

describe("workspace focus invariant", () => {
	it("shows first-install setup before the workspace", () => {
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			runtime: {} as never,
			commands: {} as never,
			mcp: {} as never,
			configuration: {} as never,
			updates: {} as never,
		};
		appMocks.configuration = {
			status: "ready",
			plan: {
				endpoint: "http://127.0.0.1:24843/mcp",
				onboardingRequired: true,
				awaitingClaudeDesktop: false,
				runtime: { status: "action-required", owner: "legacy", port: 24842 },
				findings: [],
				manualClients: [],
				restartClients: [],
			},
		};

		const { container } = render(<App />);
		expect(container.querySelector("[data-desktop-onboarding]")).not.toBeNull();
		expect(container.querySelector("[data-app-shell]")).toBeNull();
	});

	it("reveals Electron only after the hydrated workspace has rendered", async () => {
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			runtime: {} as never,
			commands: {} as never,
			mcp: {} as never,
			configuration: {} as never,
			updates: {} as never,
		};

		const { container } = render(<App />);
		const loading = container.querySelector("[data-desktop-workspace-loading]");
		expect(loading).toHaveClass("opacity-100");
		expect(container.querySelector("[data-app-shell]")).toBeNull();

		act(() => useStore.setState({ workspaceHydrated: true }));
		await waitFor(() =>
			expect(container.querySelector("[data-app-shell]")).not.toBeNull(),
		);
		await waitFor(() => expect(loading).toHaveClass("opacity-0"));
	});

	it("reveals a recoverable error when the initial desktop plan cannot load", async () => {
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			runtime: {} as never,
			commands: {} as never,
			mcp: {} as never,
			configuration: {} as never,
			updates: {} as never,
		};
		appMocks.configuration = {
			status: "error",
			plan: null,
			error: "The local runtime did not answer",
		};

		const { getByRole, container } = render(<App />);
		expect(getByRole("alert")).toHaveTextContent(
			"The local runtime did not answer",
		);
		expect(container.querySelector("[data-app-shell]")).toBeNull();
		fireEvent.click(getByRole("button", { name: /Réessayer|Try again/ }));
		expect(appMocks.refreshConfiguration).toHaveBeenCalledOnce();
		await waitFor(() =>
			expect(
				container.querySelector("[data-desktop-workspace-loading]"),
			).toHaveClass("opacity-0"),
		);
	});

	it("does not gate the web workspace on Electron hydration", () => {
		const { container } = render(<App />);

		expect(container.querySelector("[data-app-shell]")).not.toBeNull();
		expect(
			container.querySelector("[data-desktop-workspace-loading]"),
		).toBeNull();
	});

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
