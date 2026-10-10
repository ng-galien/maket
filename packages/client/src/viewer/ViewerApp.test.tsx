import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import * as bundle from "./bundle";
import ViewerApp, { viewerOptions } from "./ViewerApp";

beforeEach(() => {
	setLang("en");
	history.replaceState(null, "", "/viewer.html");
	useStore.setState({
		readOnly: false,
		darkMode: false,
		docs: new Map(),
		docList: [],
		workspaceDocNames: [],
		focusedDocName: null,
		focusedPageIndex: 0,
		collections: [],
		documentStates: {},
		stateCanvasModes: {},
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("viewerOptions", () => {
	it("recognises the iframe reader contract", () => {
		expect(
			viewerOptions(
				"?src=%2Fdocuments%2Farticle.maket&doc=article%20principal&embed=1",
			),
		).toEqual({
			src: "/documents/article.maket",
			doc: "article principal",
			embedded: true,
		});
	});

	it("keeps the regular standalone reader when embed is absent", () => {
		expect(viewerOptions("?src=/article.maket")).toEqual({
			src: "/article.maket",
			doc: null,
			embedded: false,
		});
	});

	it("opens a local bundle into the shared Reader and exposes its navigation", async () => {
		const documents = [makeDoc("alpha", 2), makeDoc("beta", 1)];
		vi.spyOn(bundle, "decodeMaketFile").mockResolvedValue({
			version: 2,
			documents,
			chartes: [],
			collections: [],
			documentStates: {},
			assetUrls: new Map(),
		});
		render(<ViewerApp />);
		const file = viewerFile();
		const dropZone =
			screen.getByText("Maket Viewer").parentElement?.parentElement;
		expect(dropZone).not.toBeNull();
		fireEvent.dragOver(dropZone as Element);
		fireEvent.dragLeave(dropZone as Element);
		fireEvent.drop(dropZone as Element, { dataTransfer: { files: [file] } });

		await screen.findByText("alpha page 1");
		expect(useStore.getState().readOnly).toBe(true);
		expect(screen.getByLabelText("Document")).toHaveTextContent("alpha");
		expect(screen.getByRole("status")).toHaveTextContent("Page 1, 1/2");

		fireEvent.click(screen.getByRole("button", { name: /Next page/ }));
		expect(screen.getByRole("status")).toHaveTextContent("Page 2, 2/2");
		fireEvent.click(screen.getByLabelText("Document"));
		fireEvent.click(screen.getByRole("option", { name: "beta" }));
		await screen.findByText("beta page 1");
		fireEvent.click(screen.getByRole("button", { name: "Toggle dark mode" }));
		expect(useStore.getState().darkMode).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "More viewer actions" }),
		);
		fireEvent.click(
			screen.getAllByRole("button", { name: "Toggle dark mode" })[1],
		);
		expect(useStore.getState().darkMode).toBe(false);
		fireEvent.click(
			screen.getByRole("button", { name: "More viewer actions" }),
		);
		fireEvent.click(
			screen.getAllByRole("button", { name: "Open another file" })[1],
		);
		fireEvent.click(screen.getByRole("button", { name: "Open another file" }));
		fireEvent.change(document.querySelector('input[type="file"]') as Element, {
			target: { files: [viewerFile()] },
		});
		await waitFor(() =>
			expect(bundle.decodeMaketFile).toHaveBeenCalledTimes(2),
		);
	});

	it("follows page links between pages of the opened document", async () => {
		const doc = makeDoc("board", 3);
		doc.pages[0].html =
			'<a data-id="to-3" href="#page=3">Open details</a><a data-id="to-2" href="#page:Page 2">Open page two</a>';
		openBundle([doc]);
		render(<ViewerApp />);
		await screen.findByText("Open details");
		expect(screen.getByRole("status")).toHaveTextContent("Page 1, 1/3");

		fireEvent.click(screen.getByText("Open details"));
		expect(screen.getByRole("status")).toHaveTextContent("Page 3, 3/3");
		fireEvent.click(screen.getByText("Open page two"));
		expect(screen.getByRole("status")).toHaveTextContent("Page 2, 2/3");
		expect(location.hash).toBe("");
	});

	it("zooms the board per document and keeps bound state controls live at 150 %", async () => {
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
		const doc = makeDoc("dashboard", 1);
		doc.dataModel = "state";
		doc.pages[0].html =
			'<label data-id="done-row"><input data-id="done" type="checkbox" data-maket-bind="state.done"> Done</label>';
		openBundle([doc], {
			dashboard: {
				schema: {
					type: "object",
					properties: { done: { type: "boolean" } },
				},
				data: { done: false },
				revision: 1,
				createdAt: "2026-10-10T00:00:00.000Z",
				templates: { [doc.pages[0].id]: doc.pages[0].html ?? "" },
			},
		});
		const view = render(<ViewerApp />);
		const checkbox = await waitFor(() => {
			const element = document.querySelector<HTMLInputElement>(
				'input[type="checkbox"][data-maket-bind]',
			);
			if (!element) throw new Error("bound checkbox not rendered");
			return element;
		});
		const zoomed = document.querySelector<HTMLElement>("[data-reader-zoom]");
		expect(zoomed?.style.zoom).toBe("1");

		for (let step = 0; step < 5; step += 1) {
			fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
		}
		expect(Number.parseFloat(zoomed?.style.zoom ?? "0")).toBeCloseTo(1.5);
		expect(
			screen.getByRole("button", { name: "Fit to view — 150%" }),
		).toBeVisible();
		expect(document.querySelector("[data-reading-workspace]")).toHaveAttribute(
			"data-reader-pannable",
		);

		const workspace = document.querySelector(
			"[data-reading-workspace]",
		) as HTMLElement;
		fireEvent.pointerDown(checkbox, {
			pointerId: 2,
			pointerType: "mouse",
			button: 0,
			clientX: 100,
			clientY: 100,
		});
		fireEvent.pointerMove(workspace, {
			pointerId: 2,
			pointerType: "mouse",
			clientX: 160,
			clientY: 100,
		});
		expect(workspace).not.toHaveAttribute("data-reader-panning");
		fireEvent.pointerUp(workspace, { pointerId: 2, pointerType: "mouse" });
		fireEvent.click(checkbox);
		expect(checkbox).toBeChecked();
		fireEvent.click(checkbox);
		expect(checkbox).not.toBeChecked();

		fireEvent.keyDown(window, { key: "-" });
		expect(Number.parseFloat(zoomed?.style.zoom ?? "0")).toBeCloseTo(1.4);
		fireEvent.keyDown(window, { key: "+" });
		expect(Number.parseFloat(zoomed?.style.zoom ?? "0")).toBeCloseTo(1.5);

		view.unmount();
		openBundle([doc, makeDoc("other", 1)]);
		const reopened = render(<ViewerApp />);
		await waitFor(() =>
			expect(
				Number.parseFloat(
					document.querySelector<HTMLElement>("[data-reader-zoom]")?.style
						.zoom ?? "0",
				),
			).toBeCloseTo(1.5),
		);
		fireEvent.keyDown(window, { key: "0" });
		expect(
			document.querySelector<HTMLElement>("[data-reader-zoom]")?.style.zoom,
		).toBe("1");
		expect(localStorage.getItem("maket.reader.zoom:doc-dashboard")).toBeNull();
		reopened.unmount();
	});

	it("pans a zoomed board by mouse drag without activating what is under the pointer", async () => {
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
		localStorage.setItem("maket.reader.zoom:doc-wide", "2");
		const doc = makeDoc("wide", 2);
		doc.pages[0].html =
			'<p data-id="body">Board body</p><a data-id="to-2" href="#page=2">Go to two</a>';
		openBundle([doc]);
		render(<ViewerApp />);
		const body = await screen.findByText("Board body");
		const workspace = document.querySelector(
			"[data-reading-workspace]",
		) as HTMLElement;
		expect(workspace).toHaveAttribute("data-reader-pannable");
		workspace.scrollLeft = 300;
		workspace.scrollTop = 200;

		fireEvent.pointerDown(body, {
			pointerId: 1,
			pointerType: "mouse",
			button: 0,
			clientX: 400,
			clientY: 300,
		});
		fireEvent.pointerMove(workspace, {
			pointerId: 1,
			pointerType: "mouse",
			clientX: 350,
			clientY: 260,
		});
		expect(workspace).toHaveAttribute("data-reader-panning");
		const boardDocument = workspace.querySelector("[data-doc]");
		expect(boardDocument).toHaveClass("reader-panning");
		expect(workspace.scrollLeft).toBe(350);
		expect(workspace.scrollTop).toBe(240);
		fireEvent.pointerUp(workspace, { pointerId: 1, pointerType: "mouse" });
		expect(workspace).not.toHaveAttribute("data-reader-panning");
		expect(boardDocument).not.toHaveClass("reader-panning");

		fireEvent.click(screen.getByText("Go to two"));
		expect(screen.getByRole("status")).toHaveTextContent("Page 1, 1/2");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		fireEvent.click(screen.getByText("Go to two"));
		expect(screen.getByRole("status")).toHaveTextContent("Page 2, 2/2");
	});

	it("keeps a minimal zoom control when embedded and the fixed-width fit at 320 px", async () => {
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
		history.replaceState(null, "", "/viewer.html?embed=1");
		openBundle([makeDoc("embedded", 1)]);
		render(<ViewerApp />);
		await screen.findByText("embedded page 1");
		const controls = screen.getByRole("group", { name: "Reader zoom" });
		expect(controls).toHaveAttribute("data-reader-zoom-controls", "minimal");
		expect(screen.queryByLabelText("Document")).toBeNull();
		const zoomed = document.querySelector<HTMLElement>("[data-reader-zoom]");
		expect(Number.parseFloat(zoomed?.style.zoom ?? "0")).toBeCloseTo(
			(320 - 24) / (100 * (96 / 25.4)),
		);
		fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
		expect(Number.parseFloat(zoomed?.style.zoom ?? "0")).toBeCloseTo(
			(320 - 24) / (100 * (96 / 25.4)) + 0.1,
		);
	});

	it("reports a bundle decoding error without leaving the drop zone", async () => {
		vi.spyOn(bundle, "decodeMaketFile").mockRejectedValue(
			new Error("Invalid fixture"),
		);
		render(<ViewerApp />);
		fireEvent.change(document.querySelector('input[type="file"]') as Element, {
			target: { files: [viewerFile()] },
		});

		await screen.findByText("Invalid fixture");
		expect(screen.getByText("Maket Viewer")).toBeVisible();
	});
});

function openBundle(
	documents: Document[],
	documentStates: Awaited<
		ReturnType<typeof bundle.decodeMaketFile>
	>["documentStates"] = {},
): void {
	vi.spyOn(bundle, "decodeMaketFile").mockResolvedValue({
		version: 2,
		documents,
		chartes: [],
		collections: [],
		documentStates,
		assetUrls: new Map(),
	});
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(new ArrayBuffer(8)),
	);
	history.replaceState(
		null,
		"",
		`/viewer.html${location.search.includes("embed=1") ? "?embed=1&src=/fixture.maket" : "?src=/fixture.maket"}`,
	);
}

function makeDoc(name: string, pageCount: number): Document {
	return {
		id: `doc-${name}`,
		name,
		category: "tests",
		dataModel: "static",
		canvas: { w: 100, h: 100, background: "#fff" },
		pages: Array.from({ length: pageCount }, (_, index) => ({
			id: `${name}-page-${index + 1}`,
			name: `Page ${index + 1}`,
			elements: [],
			html: `<p>${name} page ${index + 1}</p>`,
		})),
		activePage: 0,
	};
}

function viewerFile(): File {
	const file = new File(["fixture"], "fixture.maket", {
		type: "application/zip",
	});
	Object.defineProperty(file, "arrayBuffer", {
		value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
	});
	return file;
}
