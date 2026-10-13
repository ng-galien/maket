import type { StructuredWorkspaceView } from "@maket/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { DocSummary } from "../store/types";
import { useStore } from "../store/useStore";
import * as ws from "../store/ws";
import { StructuredWorkspacesTab } from "./StructuredWorkspacesTab";
import { WorkspaceHeader } from "./WorkspaceHeader";

const docList: DocSummary[] = [
	{
		id: "board-doc",
		name: "Delivery board",
		category: "Structured Workspaces/Delivery",
		format: "A4",
		pageCount: 1,
		elementCount: 0,
		collectionBindings: [],
	},
	{
		id: "task-doc",
		name: "Ship the release",
		category: "Structured Workspaces/Delivery",
		format: "A4",
		pageCount: 1,
		elementCount: 0,
		collectionBindings: [],
	},
];

const workspace: StructuredWorkspaceView = {
	id: "delivery",
	name: "Delivery",
	dataSchema: { type: "object" },
	representationSchema: {
		version: 1,
		collections: {
			backlog: {
				name: "Backlog",
				collectionTemplateDocumentId: "board-template",
				bindings: {
					task: {
						schemaPath: "",
						compactTemplateDocumentId: "task-template",
						detailTemplateDocumentId: "task-template",
					},
				},
			},
		},
	},
	revision: 1,
	collectionDocuments: [
		{
			collectionId: "backlog",
			documentId: "board-instance",
			documentName: "Delivery board",
		},
	],
	integrity: { status: "ready", issues: [] },
	templateDocuments: [
		{
			documentId: "board-template",
			documentName: "Board template",
			roles: [{ role: "collection", collectionId: "backlog" }],
		},
		{
			documentId: "task-template",
			documentName: "Task template",
			roles: [
				{ role: "detail", collectionId: "backlog", bindingId: "task" },
				{ role: "compact", collectionId: "backlog", bindingId: "task" },
			],
		},
	],
	items: [
		{
			id: "task-1",
			position: 0,
			collectionId: "backlog",
			bindingId: "task",
			documentId: "task-doc",
			documentName: "Ship the release",
			data: { title: "Ship" },
			dataRevision: 1,
		},
	],
	createdAt: "2026-09-19 10:00:00",
	updatedAt: "2026-09-19 10:00:00",
};

beforeEach(() => {
	setLang("en");
	useStore.setState({
		structuredWorkspaces: [workspace],
		activeStructuredWorkspaceId: "delivery",
		activeStructuredCollectionId: "backlog",
		docList,
		workspaceDocNames: ["Delivery board", "Ship the release"],
		focusedDocName: "Ship the release",
		docs: new Map(),
		structuredWorkspaceFilterRequest: null,
		settingsOpen: false,
	});
});

afterEach(cleanup);

describe("StructuredWorkspacesTab", () => {
	it("dismisses navigation only after an explicit index selection, not search or workspace expansion", async () => {
		const user = userEvent.setup();
		const onNavigate = vi.fn();
		const open = vi
			.spyOn(useStore.getState(), "openWorkspaceDocument")
			.mockImplementation(() => {});
		render(<StructuredWorkspacesTab onNavigate={onNavigate} />);
		await user.type(screen.getByRole("textbox"), "Del");
		expect(onNavigate).not.toHaveBeenCalled();
		await user.click(
			screen.getByRole("button", { name: "Show or hide workspace Delivery" }),
		);
		expect(onNavigate).not.toHaveBeenCalled();
		await user.click(
			screen.getByRole("button", { name: "Open collection index Backlog" }),
		);
		expect(open).toHaveBeenCalledWith("Delivery board", {
			workspaceId: "delivery",
			collectionId: "backlog",
		});
		expect(onNavigate).toHaveBeenCalledOnce();
		open.mockRestore();
	});

	it("clears the workspace scope when its workspace disappears from the snapshot", () => {
		const otherWorkspace = { ...workspace, id: "other", name: "Editorial" };
		useStore.setState({
			structuredWorkspaces: [workspace, otherWorkspace],
			structuredWorkspaceFilterRequest: { workspaceId: workspace.id },
		});
		render(<StructuredWorkspacesTab />);
		expect(screen.getByText("Workspace: Delivery")).toBeVisible();
		expect(
			screen.queryByRole("button", {
				name: "Show or hide workspace Editorial",
			}),
		).toBeNull();
		act(() => {
			useStore.setState({ structuredWorkspaces: [otherWorkspace] });
		});
		expect(
			screen.getByRole("button", { name: "Show or hide workspace Editorial" }),
		).toBeVisible();
		expect(screen.getByRole("textbox")).toHaveValue("");
		expect(screen.queryByText("Workspace: Delivery")).toBeNull();
		expect(screen.queryByText("No Workspace matches the search")).toBeNull();
		act(() => {
			useStore.setState({ structuredWorkspaces: [workspace, otherWorkspace] });
		});
		expect(
			screen.getByRole("button", { name: "Show or hide workspace Editorial" }),
		).toBeVisible();
		expect(
			screen.getByRole("button", { name: "Show or hide workspace Delivery" }),
		).toBeVisible();
		expect(screen.queryByText("Workspace: Delivery")).toBeNull();
	});

	it("routes owned breadcrumbs to the workspace scope and preserves the open reading context", async () => {
		const user = userEvent.setup();
		const doc = {
			id: "task-doc",
			name: "Ship the release",
			category: "Structured Workspaces/Delivery",
			canvas: { w: 210, h: 297, background: "#fff" },
			pages: [{ id: "task-page", name: "p1", elements: [] }],
			activePage: 0,
			meta: {
				structuredWorkspace: {
					role: "item" as const,
					workspaceId: "delivery",
					collectionId: "backlog",
					itemId: "task-1",
				},
			},
		};
		useStore.setState({
			structuredWorkspaces: [
				workspace,
				{ ...workspace, id: "other", name: "Delivery extended" },
			],
			docs: new Map([[doc.name, doc]]),
			libraryView: "docs",
			libraryOpen: false,
			workspaceView: "reading",
			structuredWorkspaceLayout: "split",
			documentCategoryFilterRequest: null,
		});
		const { container } = render(
			<>
				<WorkspaceHeader />
				<StructuredWorkspacesTab />
			</>,
		);
		await user.click(
			screen.getByRole("button", {
				name: "Filter workspaces by category Workspaces/Delivery",
			}),
		);
		expect(useStore.getState()).toMatchObject({
			libraryView: "structured-workspaces",
			libraryOpen: true,
			documentCategoryFilterRequest: null,
			activeStructuredWorkspaceId: "delivery",
			activeStructuredCollectionId: "backlog",
			workspaceView: "reading",
			structuredWorkspaceLayout: "split",
			workspaceDocNames: ["Delivery board", "Ship the release"],
			focusedDocName: "Ship the release",
		});
		expect(screen.getByText("Workspace: Delivery")).toBeVisible();
		expect(
			container.querySelector('[data-structured-workspace="other"]'),
		).toBeNull();
		await user.type(screen.getByRole("textbox"), "Nothing");
		await user.click(
			screen.getByRole("button", {
				name: "Filter workspaces by category Workspaces",
			}),
		);
		expect(screen.getByRole("textbox")).toHaveValue("");
		expect(
			container.querySelector('[data-structured-workspace="other"]'),
		).not.toBeNull();
		expect(screen.queryByText("Workspace: Delivery")).toBeNull();
	});

	it("lists only collection indexes without item or template children", () => {
		const { container } = render(<StructuredWorkspacesTab />);
		expect(
			container.querySelector('[data-category-path="Delivery/Backlog"]'),
		).not.toBeNull();
		expect(
			container.querySelectorAll(
				"[data-structured-item], [data-structured-template], [data-structured-definition]",
			),
		).toHaveLength(0);
		expect(
			screen.getByRole("button", { name: "Open collection index Backlog" }),
		).toBeVisible();
		expect(screen.queryByText("Ship the release")).not.toBeInTheDocument();
	});

	it("shows collection indexes as text without a document icon", () => {
		const { container } = render(<StructuredWorkspacesTab />);
		const index = screen.getByRole("button", {
			name: "Open collection index Backlog",
		});
		expect(index.querySelector("svg")).toBeNull();
		expect(index).toHaveTextContent("Backlog");
		expect(
			container.querySelector('[data-structured-collection="backlog"] svg'),
		).toBeNull();
	});

	it("keeps templates accessible in the Workspace actions menu", async () => {
		const user = userEvent.setup();
		const load = vi.spyOn(ws, "sendLoadDoc").mockReturnValue(true);
		render(<StructuredWorkspacesTab />);
		await user.click(screen.getByRole("button", { name: "Workspace actions" }));
		await user.click(
			screen.getByRole("menuitem", { name: "Open template Task template" }),
		);
		expect(load).toHaveBeenCalledWith("Task template", {
			workspaceId: "delivery",
		});
		expect(useStore.getState().stateDockOpen).toBe(true);
		load.mockRestore();
	});

	it("selects one workspace at a time and loads its collection projection", async () => {
		const user = userEvent.setup();
		const sendLoadDoc = vi.spyOn(ws, "sendLoadDoc").mockReturnValue(true);
		const boardDocument = docList[0];
		if (!boardDocument) throw new Error("Board document fixture missing.");
		const editorial: StructuredWorkspaceView = {
			...structuredClone(workspace),
			id: "editorial",
			name: "Editorial",
			representationSchema: {
				version: 1,
				collections: {
					calendar: {
						name: "Calendar",
						collectionTemplateDocumentId: "calendar-doc",
						bindings: {},
					},
				},
			},
			items: [],
			collectionDocuments: [
				{
					collectionId: "calendar",
					documentId: "calendar-instance",
					documentName: "Publishing calendar",
				},
			],
		};
		useStore.setState({
			structuredWorkspaces: [workspace, editorial],
			docList: [
				...docList,
				{
					...boardDocument,
					id: "calendar-doc",
					name: "Publishing calendar",
				},
			],
		});
		const { container } = render(<StructuredWorkspacesTab />);

		expect(
			container.querySelector('[data-category-path="Editorial/Calendar"]'),
		).toBeNull();
		await user.click(
			screen.getByRole("button", {
				name: "Show or hide workspace Editorial",
			}),
		);

		expect(
			container.querySelector('[data-category-path="Delivery/Backlog"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-category-path="Editorial/Calendar"]'),
		).not.toBeNull();
		expect(useStore.getState()).toMatchObject({
			activeStructuredWorkspaceId: "editorial",
			activeStructuredCollectionId: "calendar",
		});
		expect(sendLoadDoc).toHaveBeenCalledWith("Publishing calendar", {
			workspaceId: "editorial",
			collectionId: "calendar",
		});
		sendLoadDoc.mockRestore();
	});

	it("reopens the active collection root after it was closed", async () => {
		const user = userEvent.setup();
		const sendLoadDoc = vi.spyOn(ws, "sendLoadDoc").mockReturnValue(true);
		render(<StructuredWorkspacesTab />);
		useStore.getState().closeWorkspaceDocuments(["Delivery board"]);

		await user.click(
			screen.getByRole("button", {
				name: "Open collection index Backlog",
			}),
		);

		expect(sendLoadDoc).toHaveBeenCalledWith("Delivery board", {
			workspaceId: "delivery",
			collectionId: "backlog",
		});
		expect(useStore.getState()).toMatchObject({
			activeStructuredWorkspaceId: "delivery",
			activeStructuredCollectionId: "backlog",
		});
		sendLoadDoc.mockRestore();
	});

	it("searches only the workspace and collection indexes", async () => {
		const user = userEvent.setup();
		const { container } = render(<StructuredWorkspacesTab />);

		await user.type(
			screen.getByRole("textbox", {
				name: "Search workspaces or collection indexes",
			}),
			"Backlog",
		);
		expect(
			container.querySelector('[data-structured-workspace="delivery"]'),
		).not.toBeNull();

		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "Nothing");
		expect(
			screen.getByText("No Workspace matches the search"),
		).toBeInTheDocument();
	});

	it("blocks incomplete indexes while keeping template access in the actions menu", async () => {
		const user = userEvent.setup();
		const sendLoadDoc = vi.spyOn(ws, "sendLoadDoc").mockReturnValue(true);
		useStore.setState({
			structuredWorkspaces: [
				{
					...workspace,
					integrity: {
						status: "incomplete",
						issues: ["The collection template is missing."],
					},
				},
			],
		});
		const { container } = render(<StructuredWorkspacesTab />);

		expect(
			screen.getByText("The collection template is missing."),
		).toBeVisible();
		expect(
			container.querySelector('[data-category-path="Delivery/Backlog"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-structured-item="task-1"]'),
		).toBeNull();
		await user.click(screen.getByRole("button", { name: "Workspace actions" }));
		await user.click(
			screen.getByRole("menuitem", { name: "Open template Task template" }),
		);
		expect(sendLoadDoc).toHaveBeenCalledWith("Task template", {
			workspaceId: "delivery",
		});
		expect(useStore.getState().stateDockOpen).toBe(true);
		expect(useStore.getState().focusedCollectionName).toBeNull();
		sendLoadDoc.mockRestore();
	});

	it("renames from the anchored Workspace menu and offers hold-to-delete", async () => {
		const user = userEvent.setup();
		const rename = vi
			.spyOn(ws, "sendRenameStructuredWorkspace")
			.mockImplementation(() => {});
		render(<StructuredWorkspacesTab />);

		await user.click(screen.getByRole("button", { name: "Workspace actions" }));
		await user.click(screen.getByRole("menuitem", { name: "Rename" }));
		const input = screen.getByPlaceholderText("Rename Workspace");
		await user.clear(input);
		await user.type(input, "Operations{Enter}");
		expect(rename).toHaveBeenCalledWith("delivery", "Operations", 1);

		await user.click(screen.getByRole("button", { name: "Workspace actions" }));
		await user.click(screen.getByRole("menuitem", { name: "Delete" }));
		expect(
			screen.getByText("Hold to delete Delivery and all owned resources"),
		).toBeVisible();
		rename.mockRestore();
	});
});
