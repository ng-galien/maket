import type { StructuredWorkspaceView } from "@maket/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { DocSummary } from "../store/types";
import { useStore } from "../store/useStore";
import * as ws from "../store/ws";
import { StructuredWorkspacesTab } from "./StructuredWorkspacesTab";

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
				collectionTemplateDocumentId: "board-doc",
				bindings: {
					task: {
						schemaPath: "",
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
	});
});

afterEach(cleanup);

describe("StructuredWorkspacesTab", () => {
	it("uses the document tree hierarchy for workspaces, collections, and items", () => {
		const { container } = render(<StructuredWorkspacesTab />);

		expect(
			container.querySelector('[data-category-path="Delivery"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-category-path="Delivery/Backlog"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-structured-item="task-1"]'),
		).not.toBeNull();
		expect(
			screen.queryByText("Collection view always open"),
		).not.toBeInTheDocument();
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

	it("closes an instantiated document without removing its collection root", async () => {
		const user = userEvent.setup();
		render(<StructuredWorkspacesTab />);

		await user.click(
			screen.getByRole("button", { name: "Close Ship the release" }),
		);

		expect(useStore.getState().workspaceDocNames).toEqual(["Delivery board"]);
		expect(useStore.getState()).toMatchObject({
			activeStructuredWorkspaceId: "delivery",
			activeStructuredCollectionId: "backlog",
		});
	});

	it("reopens the active collection root after it was closed", async () => {
		const user = userEvent.setup();
		const sendLoadDoc = vi.spyOn(ws, "sendLoadDoc").mockReturnValue(true);
		render(<StructuredWorkspacesTab />);
		useStore.getState().closeWorkspaceDocuments(["Delivery board"]);

		await user.click(
			screen.getByRole("button", {
				name: "Open or collapse collection Backlog",
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

	it("filters across workspace, collection, and document names", async () => {
		const user = userEvent.setup();
		const { container } = render(<StructuredWorkspacesTab />);

		await user.type(
			screen.getByRole("textbox", {
				name: "Search workspaces, collections, or documents",
			}),
			"Ship",
		);
		expect(
			container.querySelector('[data-structured-workspace="delivery"]'),
		).not.toBeNull();

		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "Nothing");
		expect(
			screen.getByText("No Structured Workspace matches the search"),
		).toBeInTheDocument();
	});
});
