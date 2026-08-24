import type { DesktopApi } from "@maket/shared";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getDesktopConfigurationState,
	initializeDesktopConfiguration,
	resetDesktopConfigurationForTests,
} from "../desktopConfiguration";
import {
	getDesktopUpdateState,
	initializeDesktopUpdates,
	resetDesktopUpdatesForTests,
} from "../desktopUpdates";
import { setLang } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { LibraryPanel } from "./LibraryPanel";

vi.mock("./DocsTab", async () => {
	const { LibraryToolbar, LibraryToolbarActions, LibraryToolbarRow } =
		await import("./shared/LibraryToolbar");
	return {
		DocsTab: () => (
			<LibraryToolbar>
				<LibraryToolbarRow>
					<LibraryToolbarActions>
						<span>Document actions</span>
					</LibraryToolbarActions>
				</LibraryToolbarRow>
			</LibraryToolbar>
		),
	};
});
vi.mock("./ChartesTab", () => ({ ChartesTab: () => null }));
vi.mock("./PhotosTab", () => ({ PhotosTab: () => null }));
vi.mock("./CollectionsTab", () => ({ CollectionsTab: () => null }));

beforeEach(() => {
	resetDesktopUpdatesForTests();
	resetDesktopConfigurationForTests();
	localStorage.removeItem("maket-library-pinned");
	setLang("en");
	useStore.setState({
		libraryOpen: true,
		libraryPinned: false,
		libraryView: "docs",
		settingsOpen: false,
		docList: [],
		collections: [],
	});
});

afterEach(() => {
	delete window.maketDesktop;
	resetDesktopConfigurationForTests();
	cleanup();
});

describe("LibraryPanel", () => {
	it("orders and scales the library rail around the primary workflow", () => {
		render(<LibraryPanel />);

		const navigation = screen.getByRole("navigation", { name: /libraries/i });
		const buttons = within(navigation).getAllByRole("button");
		expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
			"Documents",
			"Photos",
			"Collections",
			"Brand",
			"Exchanges",
		]);
		const documents = buttons[0];
		expect(documents).toHaveClass("h-11", "w-11");
		expect(documents.querySelector("[data-library-rail-icon]")).toHaveClass(
			"scale-105",
		);
		expect(documents.querySelector(".lucide-files")).not.toBeNull();
	});

	it("reuses one pane and switches its existing feature component", async () => {
		const user = userEvent.setup();
		render(<LibraryPanel />);

		await user.click(screen.getByRole("button", { name: "Brand" }));

		expect(useStore.getState().libraryView).toBe("chartes");
		expect(
			screen.getByRole("complementary", { name: "Brand" }),
		).toBeInTheDocument();
	});

	it("collapses when the active rail icon is selected again", async () => {
		const user = userEvent.setup();
		render(<LibraryPanel />);

		await user.click(screen.getByRole("button", { name: "Documents" }));

		expect(useStore.getState().libraryOpen).toBe(false);
		const documentsButton = screen.getByRole("button", { name: "Documents" });
		expect(documentsButton).not.toHaveAttribute("aria-current");
		expect(documentsButton).toHaveAttribute("aria-expanded", "false");
		expect(documentsButton).not.toHaveClass("bg-accent-soft");
		expect(
			screen.getByRole("complementary", { name: /libraries/i }),
		).toHaveAttribute("data-library-mode", "compact");
	});

	it("keeps the pinned panel open when the active rail icon is selected again", async () => {
		const user = userEvent.setup();
		useStore.setState({ libraryPinned: true });
		render(<LibraryPanel />);

		await user.click(screen.getByRole("button", { name: "Documents" }));

		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryPinned: true,
			libraryView: "docs",
		});
		expect(screen.getByRole("button", { name: "Documents" })).toHaveAttribute(
			"aria-current",
			"page",
		);
	});

	it("toggles one full-height panel control without reducing the toolbar", async () => {
		const user = userEvent.setup();
		const { container } = render(<LibraryPanel />);

		expect(container.querySelector("[data-library-edge-close]")).toBeNull();
		expect(container.querySelector("[data-library-collapse]")).toBeNull();
		const pin = screen.getByRole("button", {
			name: "Pin navigation",
		});
		expect(pin).toHaveAttribute("aria-pressed", "false");
		expect(pin).toHaveClass(
			"absolute",
			"-right-8",
			"top-0",
			"h-[49px]",
			"w-8",
			"border-t-0",
		);
		expect(pin.querySelector(".lucide-panel-left-dashed")).not.toBeNull();
		expect(container.querySelector("[data-library-pin-accent]")).toBeNull();
		await user.click(pin);
		expect(useStore.getState().libraryPinned).toBe(true);
		expect(localStorage.getItem("maket-library-pinned")).toBe("true");
		expect(container.querySelector("[data-library-pin-accent]")).toBeNull();
		const unpin = screen.getByRole("button", { name: "Unpin navigation" });
		expect(unpin).toHaveAttribute("aria-pressed", "true");
		expect(unpin.querySelector(".lucide-panel-left")).not.toBeNull();
		expect(unpin.querySelector("[data-library-pin-state]")).not.toBeNull();
		await user.click(unpin);
		expect(useStore.getState().libraryPinned).toBe(false);
		expect(localStorage.getItem("maket-library-pinned")).toBe("false");
		expect(useStore.getState().libraryOpen).toBe(false);
		expect(localStorage.getItem("maket-library-open")).toBe("false");
		expect(screen.queryByRole("button", { name: "Pin navigation" })).toBeNull();
	});

	it("collapses to a persistent rail and opens the selected library", async () => {
		const user = userEvent.setup();
		useStore.setState({ libraryOpen: false });
		render(<LibraryPanel />);
		const rail = screen.getByRole("complementary", { name: /libraries/i });
		expect(rail).toHaveAttribute("data-library-mode", "compact");

		const collectionsButton = screen.getByRole("button", {
			name: "Collections",
		});
		expect(collectionsButton.querySelector(".lucide-database")).not.toBeNull();
		await user.click(collectionsButton);

		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryView: "collections",
		});
		expect(
			screen.getByRole("complementary", { name: "Collections" }),
		).toHaveAttribute("data-library-mode", "extended");
	});

	it("scrolls vertically without clipping its portaled tooltips", async () => {
		const user = userEvent.setup();
		useStore.setState({ libraryOpen: false });
		render(<LibraryPanel />);

		const navigation = screen.getByRole("navigation", { name: /libraries/i });
		expect(navigation).toHaveClass("overflow-y-auto", "overflow-x-hidden");
		await user.hover(screen.getByRole("button", { name: "Documents" }));
		expect(screen.getByRole("tooltip")).toHaveTextContent("Documents");
		expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
	});

	it("animates only the central grip while resizing", () => {
		const { container } = render(<LibraryPanel />);
		const resize = screen.getByRole("separator", {
			name: "Resize library panel",
		});
		const grip = resize.querySelector("[data-resize-grip]");

		expect(resize.querySelector("[data-resize-guide]")).toBeNull();
		expect(grip).toHaveClass("h-9", "w-px", "bg-text-3/45");

		fireEvent.pointerDown(resize, { clientX: 400 });
		expect(resize).toHaveAttribute("data-resizing", "true");
		expect(grip).toHaveClass("h-16", "w-[5px]", "bg-accent/80");
		expect(container.querySelector("[data-library-panel]")).toHaveAttribute(
			"data-resizing",
			"true",
		);

		fireEvent.pointerUp(window);
		expect(resize).not.toHaveAttribute("data-resizing");
	});

	it("stays above collection and state workspaces", () => {
		render(<LibraryPanel />);
		expect(
			screen.getByRole("complementary", { name: "Documents" }),
		).toHaveClass("z-[var(--z-bar)]");
	});

	it("keeps only Help and Settings in the utility rail", async () => {
		const user = userEvent.setup();
		render(<LibraryPanel />);

		expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
		const settings = screen.getByRole("button", { name: "Settings" });
		expect(settings).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Language" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Dark mode" })).toBeNull();

		await user.click(settings);
		expect(useStore.getState()).toMatchObject({
			settingsOpen: true,
			libraryOpen: false,
		});
		expect(settings).toHaveAttribute("aria-current", "page");
	});

	it("does not show an error badge when the update service is unavailable", async () => {
		window.maketDesktop = {
			updates: {
				getState: async () => ({
					status: "unavailable",
					channel: "stable",
					currentVersion: "2.0.0",
					reason: "service-unavailable",
				}),
				onState: () => () => {},
			},
		} as unknown as DesktopApi;
		initializeDesktopUpdates();
		await waitFor(() =>
			expect(getDesktopUpdateState().status).toBe("unavailable"),
		);
		render(<LibraryPanel />);

		const settings = screen.getByRole("button", { name: "Settings" });
		expect(settings.querySelector(".bg-danger")).toBeNull();
	});

	it("keeps configuration attention on the Settings badge without a competing popover", async () => {
		window.maketDesktop = {
			configuration: {
				getPlan: async () => ({
					endpoint: "http://127.0.0.1:24843/mcp",
					onboardingRequired: false,
					awaitingClaudeDesktop: false,
					runtime: {
						status: "action-required",
						owner: "legacy",
						host: "127.0.0.1",
						port: 24842,
					},
					findings: [
						{
							client: "codex",
							scope: "user",
							path: "/tmp/.codex/config.toml",
							status: "missing",
							detail: "Not configured",
							detected: true,
							managed: false,
							skillPath: "/tmp/.agents/skills/maket/SKILL.md",
							mcpStatus: "missing",
							skillStatus: "missing",
						},
					],
					manualClients: [],
					restartClients: [],
				}),
			},
		} as unknown as DesktopApi;
		initializeDesktopConfiguration();
		await waitFor(() =>
			expect(getDesktopConfigurationState().status).toBe("ready"),
		);

		render(<LibraryPanel />);
		const settings = screen.getByRole("button", { name: "Settings" });
		expect(settings.querySelector(".bg-accent")).not.toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
	});
});
