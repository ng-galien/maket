import { cleanup, render } from "@testing-library/react";
import { memo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";

const pageCanvasRender = vi.hoisted(() => vi.fn());

vi.mock("./PageCanvas", () => ({
	PageCanvas: memo(function PageCanvasProbe(props: unknown) {
		pageCanvasRender(props);
		return <div data-testid="page-canvas" />;
	}),
}));

const { WorkspaceDoc } = await import("./WorkspaceDoc");

const doc: Document = {
	id: "doc-poster",
	name: "poster",
	category: "tests",
	canvas: { w: 210, h: 297, background: "#fff" },
	pages: [{ id: "page-1", name: "Page 1", elements: [], html: "<p>Hello</p>" }],
	activePage: 0,
};

beforeEach(() => {
	setLang("en");
	pageCanvasRender.mockClear();
	useStore.setState({
		docs: new Map([[doc.name, doc]]),
		workspaceDocNames: [doc.name],
		focusedDocName: doc.name,
		focusedPageIndex: 0,
		collections: [],
		collectionCursors: {},
		collectionDrafts: {},
		draftCursorOverrides: {},
		readOnly: false,
	});
});

afterEach(cleanup);

describe("WorkspaceDoc zoom rendering", () => {
	it("keeps page canvas props stable while only the zoom label scale changes", () => {
		const view = render(<WorkspaceDoc docName={doc.name} zoomK={1} />);
		expect(pageCanvasRender).toHaveBeenCalledOnce();

		view.rerender(<WorkspaceDoc docName={doc.name} zoomK={0.75} />);

		expect(pageCanvasRender).toHaveBeenCalledOnce();
	});
});
