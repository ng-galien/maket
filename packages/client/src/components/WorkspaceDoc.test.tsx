import type { Collection } from "@maket/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
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
	});
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
