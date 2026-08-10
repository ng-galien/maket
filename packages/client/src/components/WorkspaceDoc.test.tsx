import { type Collection, collectionCursorKey } from "@maket/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import * as ws from "../store/ws";
import { WorkspaceDoc } from "./WorkspaceDoc";

const collection: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { client_name: { type: "string" } },
		required: ["client_name"],
		additionalProperties: false,
	},
	members: [{ id: "member_1", position: 0, data: { client_name: "Acme" } }],
};

beforeEach(() => {
	setLang("en");
});

afterEach(() => {
	cleanup();
	useStore.setState({
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		focusedPageIndex: 0,
		focusedCollectionName: null,
		collections: [],
		collectionCursors: {},
		collectionDrafts: {},
		selectedIds: [],
		readOnly: false,
		documentStates: {},
	});
	vi.restoreAllMocks();
});

describe("WorkspaceDoc page focus", () => {
	it("does not render collection controls on the canvas", () => {
		const doc = makeDoc();
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 0,
			collections: [collection],
		});
		useStore.getState().setCollectionCursors([
			{
				docName: doc.name,
				pageIndex: 0,
				collection: "clients",
				mode: "template",
				memberId: "member_1",
			},
		]);

		render(<WorkspaceDoc docName={doc.name} zoomK={1} />);

		expect(
			screen.queryByRole("button", { name: "Open data" }),
		).not.toBeInTheDocument();
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
	});

	it("activates and selects an element on an inactive page with one click", () => {
		const doc = makeDoc(2);
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 0,
			selectedIds: ["title"],
		});

		const { container } = render(<WorkspaceDoc docName={doc.name} zoomK={1} />);
		const secondPage = container.querySelector('[data-page-view="1"]');
		expect(secondPage).not.toBeNull();
		const title = secondPage?.querySelector('[data-id="title"]');
		expect(title).not.toBeNull();

		fireEvent.click(title as Element);

		expect(useStore.getState().focusedDocName).toBe("poster");
		expect(useStore.getState().focusedPageIndex).toBe(1);
		expect(useStore.getState().selectedIds).toEqual(["title"]);
		expect(secondPage).toHaveAttribute("data-active-page", "true");
		expect(title).toHaveClass("selected");
	});

	it("turns collection members into passive reader pages without changing the shared cursor", () => {
		const doc = makeDoc();
		const fiveMembers: Collection = {
			...collection,
			members: Array.from({ length: 5 }, (_, index) => ({
				id: `member_${index + 1}`,
				position: index,
				data: { client_name: `Client ${index + 1}` },
			})),
		};
		const cursor = {
			docName: doc.name,
			pageIndex: 0,
			collection: "clients",
			mode: "template" as const,
			memberId: "member_3",
		};
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 0,
			collections: [fiveMembers],
			collectionCursors: { [collectionCursorKey(doc.name, 0)]: cursor },
		});
		const originalCursors = structuredClone(
			useStore.getState().collectionCursors,
		);

		const { container } = render(
			<WorkspaceDoc
				docName={doc.name}
				zoomK={1}
				showDocumentLabel={false}
				showPageLabels={false}
				surface="reader"
			/>,
		);

		expect(container.querySelectorAll("[data-reader-page-index]")).toHaveLength(
			5,
		);
		expect(container.textContent).toContain("Client 1");
		expect(container.textContent).toContain("Client 5");
		expect(container.querySelector(".data-preview")).toBeNull();
		expect(useStore.getState().collectionCursors).toEqual(originalCursors);

		fireEvent.click(container.querySelector('[data-id="title"]') as Element);
		expect(useStore.getState().selectedIds).toEqual([]);
		expect(document.querySelector(".element-toolbar")).toBeNull();
	});

	it("renders an explicit empty Reader state instead of the collection template", () => {
		const doc = makeDoc();
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			collections: [{ ...collection, members: [] }],
		});

		render(
			<WorkspaceDoc
				docName={doc.name}
				zoomK={1}
				showDocumentLabel={false}
				surface="reader"
			/>,
		);

		expect(screen.getByRole("status")).toHaveTextContent(
			"This collection has no pages to read",
		);
		expect(document.querySelector("[data-reader-page-index]")).toBeNull();
		expect(document.body).not.toHaveTextContent("{{ client_name }}");
	});

	it("does not expose a template when its collection is unavailable in Reader", () => {
		const doc = makeDoc();
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			collections: [],
		});

		render(
			<WorkspaceDoc
				docName={doc.name}
				zoomK={1}
				showDocumentLabel={false}
				surface="reader"
			/>,
		);

		expect(screen.getByRole("status")).toHaveTextContent(
			'Collection "clients" is unavailable',
		);
		expect(document.querySelector("[data-reader-page-index]")).toBeNull();
		expect(document.body).not.toHaveTextContent("{{ client_name }}");
	});

	it("keeps state interactions local for a locked static bundle", () => {
		const sendPatch = vi.spyOn(ws, "sendStateValuePatch");
		const doc = makeDoc();
		doc.dataModel = "state";
		doc.meta = { locked: true };
		const page = doc.pages[0];
		if (!page) throw new Error("Expected one test page");
		page.collection = undefined;
		page.html =
			'<input aria-label="Done" type="checkbox" data-maket-bind="state.done" data-maket-path="/done" data-maket-type="boolean">';
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			readOnly: true,
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { done: false },
					revision: 1,
					createdAt: "2026-08-10T00:00:00.000Z",
					templates: { [page.id]: page.html ?? "" },
				},
			},
		});

		render(
			<WorkspaceDoc
				docName={doc.name}
				zoomK={1}
				showDocumentLabel={false}
				surface="reader"
				dataSource="static"
			/>,
		);
		const checkbox = screen.getByRole("checkbox", { name: "Done" });
		fireEvent.click(checkbox);
		expect(checkbox).toBeChecked();
		expect(sendPatch).not.toHaveBeenCalled();
	});
});

function makeDoc(pageCount = 1): Document {
	return {
		id: "doc-1",
		name: "poster",
		category: "smoke",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: Array.from({ length: pageCount }, (_, index) => ({
			id: `page-${index + 1}`,
			name: `Page ${index + 1}`,
			elements: [],
			html: '<p data-id="title">{{ client_name }}</p>',
			collection: index === 0 ? { name: "clients" } : undefined,
		})),
		activePage: 0,
	};
}
