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
		documentLabelPosition: "bottom",
	});
});

afterEach(cleanup);

describe("WorkspaceDoc zoom rendering", () => {
	it("keeps the label aligned to the document width and at a constant screen gap across zoom levels", () => {
		const view = render(<WorkspaceDoc docName={doc.name} zoomK={1} />);
		expect(pageCanvasRender).toHaveBeenCalledOnce();
		assertLabelGeometry(view.container, 1);

		view.rerender(<WorkspaceDoc docName={doc.name} zoomK={0.75} />);
		assertLabelGeometry(view.container, 0.75);

		view.rerender(<WorkspaceDoc docName={doc.name} zoomK={2} />);
		assertLabelGeometry(view.container, 2);

		expect(pageCanvasRender).toHaveBeenCalledOnce();
	});
});

function assertLabelGeometry(container: HTMLElement, zoomK: number): void {
	const docWidth = doc.canvas.w * 3.78;
	const documentScreenWidth = docWidth * zoomK;
	const selectionFrame = container.querySelector<HTMLElement>(
		'[data-selection-frame="true"]',
	);
	const label = container.querySelector<HTMLElement>(".doc-label");
	const band = label?.firstElementChild as HTMLElement | null;

	expect(selectionFrame).not.toBeNull();
	expect(label).not.toBeNull();
	expect(band).not.toBeNull();
	expect(Number.parseFloat(selectionFrame?.style.width ?? "0")).toBeCloseTo(
		documentScreenWidth + 10,
	);
	expect(selectionFrame?.style.transform).toBe(`scale(${1 / zoomK})`);
	expect(
		Number.parseFloat(selectionFrame?.style.left ?? "0") * zoomK,
	).toBeCloseTo(-5);
	expect(Number.parseFloat(selectionFrame?.style.borderWidth ?? "0")).toBe(2);
	expect(Number.parseFloat(label?.style.width ?? "0")).toBeCloseTo(docWidth);
	expect(Number.parseFloat(band?.style.width ?? "0")).toBeCloseTo(
		documentScreenWidth,
	);
	expect(label?.style.transform).toBe(`scale(${1 / zoomK})`);
	expect(
		(12 + Number.parseFloat(label?.style.marginTop ?? "0")) * zoomK,
	).toBeCloseTo(8);
}
