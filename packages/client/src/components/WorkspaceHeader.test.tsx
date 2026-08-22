import type { Collection } from "@maket/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { registerFitToView } from "../store/zoomBridge";
import { WorkspaceHeader } from "./WorkspaceHeader";

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

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "flyer",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-page-1`, name: "p1", elements: [] }],
		activePage: 0,
	};
}

beforeEach(() => {
	setLang("en");
	delete window.maketDesktop;
	useStore.setState({
		connected: false,
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		focusedPageIndex: 0,
		focusedCollectionName: null,
		dataDockMode: "split",
		pending: [],
		collections: [],
		collectionDrafts: {},
		collectionCursors: {},
		libraryView: "docs",
		libraryOpen: true,
		workspaceView: "canvas",
		settingsOpen: false,
		themeMode: "light",
		darkMode: false,
		readOnly: false,
		documentStates: {},
		stateCanvasModes: {},
		stateDockOpen: false,
		statePatchPending: {},
		statePatchErrors: {},
	});
});

afterEach(() => {
	registerFitToView(() => undefined);
	vi.restoreAllMocks();
	cleanup();
});

describe("WorkspaceHeader", () => {
	it("integrates the shared header into the macOS title bar", () => {
		window.maketDesktop = {
			version: 1,
			platform: "darwin",
			runtime: {} as never,
			commands: {} as never,
			mcp: {} as never,
			updates: {} as never,
		};
		render(<WorkspaceHeader />);
		const header = screen.getByRole("banner");
		expect(header).toHaveAttribute("data-window-drag", "true");
		expect(header).toHaveClass("pl-[86px]");
	});

	it("opens the document library from the empty document context", async () => {
		const user = userEvent.setup();
		useStore.setState({ libraryOpen: false, libraryView: "collections" });
		render(<WorkspaceHeader />);

		await user.click(screen.getByRole("button", { name: "Open document" }));

		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryView: "docs",
		});
		expect(
			screen.queryByRole("link", { name: "Print" }),
		).not.toBeInTheDocument();
	});

	it("uses a settings context instead of document controls on the settings page", () => {
		useStore.setState({ settingsOpen: true });
		render(<WorkspaceHeader />);

		expect(screen.getByRole("banner")).toHaveAttribute("data-settings-header");
		expect(screen.getByText("Settings")).toBeVisible();
		expect(screen.queryByRole("button", { name: "Open document" })).toBeNull();
	});

	it("leaves navigation collapse to the panel edge control", () => {
		render(<WorkspaceHeader />);

		expect(
			screen.queryByRole("button", { name: "Collapse navigation" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("banner").firstElementChild).toHaveClass("flex-1");
	});

	it("uses the breadcrumb to request an additive document category filter", async () => {
		const user = userEvent.setup();
		const doc = makeDoc("category-navigation");
		doc.category = "Produits/Maket/Conception";
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			libraryOpen: false,
			libraryView: "collections",
			documentCategoryFilterRequest: null,
		});
		render(<WorkspaceHeader />);

		await user.click(
			screen.getByRole("button", {
				name: "Filter documents by category Produits/Maket",
			}),
		);

		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryView: "docs",
			documentCategoryFilterRequest: { path: "Produits/Maket" },
		});
	});

	it("switches between the documents already open in the workspace", async () => {
		const user = userEvent.setup();
		const alpha = makeDoc("Alpha");
		const beta = makeDoc("Beta");
		useStore.setState({
			docs: new Map([
				[alpha.name, alpha],
				[beta.name, beta],
			]),
			workspaceDocNames: [alpha.name, beta.name],
			focusedDocName: alpha.name,
		});
		render(<WorkspaceHeader />);

		await user.click(screen.getByRole("button", { name: "Document" }));
		const betaOption = screen.getByRole("option", { name: "Beta" });
		expect(betaOption).toHaveAccessibleDescription("Maket / flyer");
		await user.click(betaOption);

		expect(useStore.getState().focusedDocName).toBe("Beta");
	});

	it("closes one or every open document from the document picker", async () => {
		const user = userEvent.setup();
		const alpha = makeDoc("Alpha");
		const beta = makeDoc("Beta");
		useStore.setState({
			docs: new Map([
				[alpha.name, alpha],
				[beta.name, beta],
			]),
			workspaceDocNames: [alpha.name, beta.name],
			focusedDocName: alpha.name,
		});
		render(<WorkspaceHeader />);

		await user.click(screen.getByRole("button", { name: "Document" }));
		await user.click(screen.getByRole("button", { name: "Close Beta" }));
		expect(useStore.getState().workspaceDocNames).toEqual(["Alpha"]);
		expect(useStore.getState().focusedDocName).toBe("Alpha");

		await user.click(screen.getByRole("button", { name: "Close all" }));
		expect(useStore.getState().workspaceDocNames).toEqual([]);
		expect(useStore.getState().focusedDocName).toBeNull();
	});

	it("switches to reading while clearing transient authoring surfaces", async () => {
		const user = userEvent.setup();
		const doc = makeDoc("long-report");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedCollectionName: "clients",
			selectedIds: ["title"],
			editingElementId: "title",
			showPopover: true,
		});
		const activity = document.createElement("div");
		activity.dataset.maketActivity = "";
		document.body.appendChild(activity);

		render(<WorkspaceHeader />);
		await user.click(screen.getByRole("button", { name: "Reading view" }));

		expect(useStore.getState()).toMatchObject({
			workspaceView: "reading",
			focusedCollectionName: null,
			selectedIds: [],
			editingElementId: null,
			showPopover: false,
		});
		expect(document.querySelector("[data-maket-activity]")).toBeNull();
	});

	it("keeps print server-owned and URL-encodes the focused document name", () => {
		const doc = makeDoc("flyer été 2026");
		doc.category = "Produits/Maket/Conception";
		doc.pages[0].collection = { name: "clients" };
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			focusedDocName: doc.name,
			collections: [clientsCollection],
		});
		render(<WorkspaceHeader />);
		expect(screen.getByText(doc.name)).toBeInTheDocument();
		expect(
			screen.getByRole("navigation", { name: "Document location" }),
		).toHaveAttribute("title", "Maket / Produits / Maket / Conception");
		expect(screen.getByRole("link", { name: "Print" })).toHaveAttribute(
			"href",
			"/print?name=flyer+%C3%A9t%C3%A9+2026",
		);
	});

	it("opens state-backed document controls beside the document context", async () => {
		const user = userEvent.setup();
		const doc = makeDoc("living-checklist");
		doc.dataModel = "state";
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			focusedDocName: doc.name,
		});
		render(<WorkspaceHeader />);

		expect(screen.queryByRole("button", { name: "Template" })).toBeNull();
		await user.click(
			screen.getByRole("button", { name: "Open document state" }),
		);
		expect(useStore.getState().stateDockOpen).toBe(true);
	});

	it("hides the contextual data control for an unbound page", () => {
		const doc = makeDoc("poster");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			focusedDocName: doc.name,
			collections: [clientsCollection],
		});
		render(<WorkspaceHeader />);
		expect(document.querySelector("[data-collection-dock-trigger]")).toBeNull();
		expect(screen.queryByRole("dialog", { name: "Data source" })).toBeNull();
	});

	it("places bound data beside the document and toggles the bottom dock", async () => {
		const user = userEvent.setup();
		const doc = makeDoc("poster");
		doc.pages[0].collection = { name: "clients" };
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			focusedDocName: doc.name,
			collections: [clientsCollection],
			dataDockMode: "split",
		});
		render(<WorkspaceHeader />);
		const trigger = document.querySelector<HTMLButtonElement>(
			"[data-collection-dock-trigger]",
		);
		expect(trigger).not.toBeNull();
		expect(document.querySelector("[data-document-context]")).toContainElement(
			trigger,
		);
		expect(trigger).toHaveAttribute("aria-pressed", "false");
		if (!trigger) throw new Error("missing collection dock trigger");
		await user.click(trigger);

		expect(useStore.getState().focusedCollectionName).toBe("clients");
		expect(useStore.getState().dataDockMode).toBe("split");
		expect(trigger).toHaveAttribute("aria-pressed", "true");

		await user.click(trigger);
		expect(useStore.getState().focusedCollectionName).toBeNull();
		expect(trigger).toHaveAttribute("aria-pressed", "false");
	});

	it("keeps fit-to-view in the document toolbar without a redundant actions menu", async () => {
		const user = userEvent.setup();
		const doc = makeDoc("poster");
		let fits = 0;
		registerFitToView(() => {
			fits += 1;
		});
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			focusedDocName: doc.name,
		});
		render(<WorkspaceHeader />);
		await user.click(screen.getByRole("button", { name: "Fit to view" }));
		expect(fits).toBe(1);
		expect(
			screen.queryByRole("button", { name: "More actions" }),
		).not.toBeInTheDocument();
	});

	it("locks and unlocks the focused document from the document header", async () => {
		const user = userEvent.setup();
		const sendLock = vi.fn();
		const doc = makeDoc("protected-poster");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			focusedDocName: doc.name,
		});
		const { rerender } = render(<WorkspaceHeader onDocumentLock={sendLock} />);
		await user.click(
			screen.getByRole("button", { name: "Lock (MCP read-only)" }),
		);
		expect(sendLock).toHaveBeenCalledWith(doc.name, true);

		doc.meta = { locked: true };
		useStore.setState({ docs: new Map([[doc.name, { ...doc }]]) });
		rerender(<WorkspaceHeader onDocumentLock={sendLock} />);
		await user.click(screen.getByRole("button", { name: "Unlock" }));
		expect(sendLock).toHaveBeenLastCalledWith(doc.name, false);
	});

	it("shows the existing connection state", () => {
		const { rerender } = render(<WorkspaceHeader />);
		expect(screen.getByLabelText("Maket disconnected")).toHaveClass(
			"bg-danger",
		);
		useStore.setState({ connected: true });
		rerender(<WorkspaceHeader />);
		expect(screen.getByLabelText("Maket connected")).toHaveClass("bg-accent");
	});
});
