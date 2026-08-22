import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { LibraryPanel } from "./LibraryPanel";

vi.mock("./DocsTab", () => ({ DocsTab: () => null }));
vi.mock("./ChartesTab", () => ({ ChartesTab: () => null }));
vi.mock("./PhotosTab", () => ({ PhotosTab: () => null }));
vi.mock("./CollectionsTab", () => ({ CollectionsTab: () => null }));

beforeEach(() => {
	setLang("en");
	useStore.setState({
		libraryOpen: true,
		libraryView: "docs",
		settingsOpen: false,
		docList: [],
		collections: [],
	});
});

afterEach(cleanup);

describe("LibraryPanel", () => {
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

	it("collapses from the control on the middle of the panel edge", async () => {
		const user = userEvent.setup();
		render(<LibraryPanel />);

		const close = screen.getByRole("button", {
			name: "Collapse navigation",
		});
		expect(close).toHaveAttribute("data-library-edge-close");
		expect(close).toHaveClass("top-1/2", "-right-8");
		expect(close).toHaveClass("border-accent", "bg-panel", "text-accent");
		expect(close).not.toHaveClass("bg-accent-soft");
		expect(close.querySelector(".lucide-chevron-left")).not.toBeNull();

		await user.click(close);

		expect(useStore.getState().libraryOpen).toBe(false);
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
});
