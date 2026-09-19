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
		pending: [],
		readOnly: false,
		documentStates: {},
	});
	vi.restoreAllMocks();
});

describe("WorkspaceDoc page focus", () => {
	it("keeps the persistent document label compact while preserving the note count and close action", () => {
		const doc = makeDoc(2);
		doc.name = "Quarterly delivery report with a deliberately long title";
		doc.dataModel = "state";
		doc.canvas = {
			...doc.canvas,
			format: "A4",
			orientation: "portrait",
		};
		doc.meta = {
			emailDraftUrl: "https://mail.google.com/mail/u/0/#drafts/example",
			emailDraftRole: "body",
		};
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 0,
			pending: [
				{ id: "note-1", docName: doc.name, type: "note", ts: 1 },
				{ id: "note-2", docName: doc.name, type: "note", ts: 2 },
			],
		});

		const { container } = render(<WorkspaceDoc docName={doc.name} zoomK={1} />);
		const label = container.querySelector(".doc-label");
		const band = label?.firstElementChild;
		const title = band?.querySelector(".doc-label-name");

		expect(band).not.toBeNull();
		expect(label).toHaveClass("pointer-events-none");
		expect(band).toHaveClass("pointer-events-auto");
		expect(
			Array.from(band?.children ?? []).map((child) => child.tagName),
		).toEqual(["SPAN", "SPAN", "BUTTON"]);
		expect(title).toHaveTextContent(doc.name);
		expect(title).toHaveTextContent(`smoke / ${doc.name}`);
		expect(title).toHaveClass("font-bold", "text-accent");
		expect(title).toHaveClass("min-w-0", "shrink");
		expect(band).toHaveClass(
			"shrink-0",
			"justify-center",
			"gap-1.5",
			"px-3",
			"py-1",
			"rounded-xl",
			"bg-accent-soft",
		);
		expect(band).not.toHaveTextContent("A4");
		expect(band).not.toHaveTextContent("2p");
		expect(band).not.toHaveTextContent("State");
		expect(band?.querySelector("a")).toBeNull();
		expect(band?.children[1]).toHaveTextContent("2");
		const close = screen.getByRole("button", { name: "Close" });
		expect(close).toHaveClass("w-5", "h-5", "border-none", "bg-transparent");
		expect(label?.querySelector(".doc-tooltip")).toHaveTextContent(
			"A4 portrait",
		);
		expect(label?.querySelector(".doc-tooltip")).toHaveTextContent("2 pages");
		expect(label?.querySelector(".doc-tooltip")).toHaveTextContent("2 pending");

		fireEvent.click(close);
		expect(useStore.getState().workspaceDocNames).toEqual([]);
	});

	it("limits the label hitbox to the visible band while preserving focus and close actions", () => {
		const updater = makeDoc();
		updater.id = "doc-updater";
		updater.name = "Updater diagnostics";
		const stabilize = makeDoc();
		stabilize.id = "doc-stabilize";
		stabilize.name = "Stabilize PDF export";
		useStore.setState({
			docs: new Map([
				[updater.name, updater],
				[stabilize.name, stabilize],
			]),
			workspaceDocNames: [updater.name, stabilize.name],
			focusedDocName: stabilize.name,
		});

		const { container } = render(
			<>
				<WorkspaceDoc docName={updater.name} zoomK={0.25} />
				<WorkspaceDoc docName={stabilize.name} zoomK={0.25} />
			</>,
		);
		const updaterDoc = container.querySelector<HTMLElement>(
			`[data-doc="${updater.name}"]`,
		);
		const wrapper = updaterDoc?.querySelector(".doc-label");
		const band = wrapper?.firstElementChild;
		const title = band?.querySelector(".doc-label-name");

		expect(wrapper).toHaveClass("pointer-events-none");
		expect(band).toHaveClass("pointer-events-auto");
		fireEvent.click(title ?? (band as Element));
		expect(useStore.getState()).toMatchObject({
			focusedDocName: updater.name,
			workspaceDocNames: [updater.name, stabilize.name],
		});

		fireEvent.click(
			updaterDoc?.querySelector(".doc-close-btn") as HTMLButtonElement,
		);
		expect(useStore.getState()).toMatchObject({
			focusedDocName: stabilize.name,
			workspaceDocNames: [stabilize.name],
		});
	});

	it("progressively hides secondary label content while keeping the close action visible", () => {
		const doc = makeDoc();
		doc.name = "A long narrow document title";
		doc.canvas = { ...doc.canvas, w: 40 };
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: null,
			pending: [{ id: "note-1", docName: doc.name, type: "note", ts: 1 }],
		});

		const view = render(<WorkspaceDoc docName={doc.name} zoomK={1} />);
		let band = view.container.querySelector<HTMLElement>(".doc-label > div");

		expect(Number.parseFloat(band?.style.width ?? "0")).toBeLessThan(152);
		expect(
			Array.from(band?.children ?? []).map((child) => child.tagName),
		).toEqual(["SPAN", "SPAN", "BUTTON"]);
		expect(band?.querySelector(".doc-label-name")).toHaveTextContent(doc.name);
		expect(band).not.toHaveTextContent(`smoke / ${doc.name}`);
		expect(band?.children[1]).toHaveTextContent("1");

		view.rerender(<WorkspaceDoc docName={doc.name} zoomK={0.7} />);
		band = view.container.querySelector<HTMLElement>(".doc-label > div");
		expect(band?.querySelector(".doc-label-name")).toHaveTextContent(doc.name);
		expect(band?.children).toHaveLength(3);
		expect(band).toHaveTextContent("1");
		expect(
			Number.parseFloat(
				band?.querySelector<HTMLElement>(".doc-label-name")?.style.maxWidth ??
					"0",
			),
		).toBeLessThan(40);

		view.rerender(<WorkspaceDoc docName={doc.name} zoomK={0.5} />);
		band = view.container.querySelector<HTMLElement>(".doc-label > div");
		const close = screen.getByRole("button", { name: "Close" });
		expect(band?.children).toHaveLength(2);
		expect(band?.querySelector(".doc-label-name")).toBeNull();
		expect(band).toHaveTextContent("1");

		view.rerender(<WorkspaceDoc docName={doc.name} zoomK={0.3} />);
		band = view.container.querySelector<HTMLElement>(".doc-label > div");
		expect(band?.children).toHaveLength(1);
		expect(band).not.toHaveTextContent("1");

		view.rerender(<WorkspaceDoc docName={doc.name} zoomK={0.1} />);
		band = view.container.querySelector<HTMLElement>(".doc-label > div");
		expect(Number.parseFloat(band?.style.width ?? "0")).toBe(44);
		expect(close).toBeVisible();
		expect(close).toHaveClass(
			"shrink-0",
			"w-5",
			"h-5",
			"border-none",
			"bg-transparent",
		);
	});

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
