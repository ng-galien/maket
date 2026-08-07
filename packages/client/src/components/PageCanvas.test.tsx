import type { Collection } from "@maket/shared";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../store/types";
import { statePatchKey, useStore } from "../store/useStore";
import * as ws from "../store/ws";
import { isTextEditable, PageCanvas, parseCSSVars } from "./PageCanvas";

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
		setTimeout(() => cb(0), 0);
		return 1;
	});
});

afterEach(() => {
	cleanup();
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	useStore.setState({
		readOnly: false,
		pending: [],
		editingElementId: null,
		selectedIds: [],
		showPopover: false,
		collections: [],
		collectionCursors: {},
		documentStates: {},
		stateCanvasModes: {},
		statePatchPending: {},
		statePatchRequests: {},
		statePatchErrors: {},
	});
});

describe("PageCanvas toolbar interactions", () => {
	it("selects an element and shows the toolbar", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">Editable</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		const target = document.querySelector('[data-id="a"]') as HTMLElement;
		await act(async () => {
			fireEvent.click(target);
		});
		expect(useStore.getState().selectedIds).toEqual(["a"]);
		expect(document.querySelector(".element-toolbar")).not.toBeNull();
		expect(target.classList.contains("selected")).toBe(true);
	});

	it("keeps state-backed live layout passive without selecting elements", async () => {
		const doc = makeDoc('<p data-id="a">Rendered state</p>');
		doc.dataModel = "state";
		const { container } = render(
			<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />,
		);

		const canvas = container.querySelector(".page-canvas");
		const target = container.querySelector('[data-id="a"]') as HTMLElement;
		await act(async () => {
			fireEvent.click(target);
		});

		expect(canvas).toHaveAttribute("data-document-mode", "state");
		expect(useStore.getState().selectedIds).toEqual([]);
		expect(document.querySelector(".element-toolbar")).toBeNull();
		expect(target).not.toHaveClass("selected");
	});

	it("patches a native checkbox from its change event and current revision", async () => {
		const sendPatch = vi
			.spyOn(ws, "sendStateValuePatch")
			.mockImplementation(() => "request-1");
		const doc = makeDoc(
			'<label data-id="a"><input type="checkbox" data-maket-bind="state.done" data-maket-path="/done" data-maket-type="boolean"></label>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { done: false },
					revision: 4,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "{{ state.done }}" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		await act(async () => {
			fireEvent.change(document.querySelector("input") as HTMLInputElement, {
				target: { checked: true },
			});
		});

		expect(sendPatch).toHaveBeenCalledWith("alpha", "/done", 4, true);
		expect(document.querySelector("[data-state-value-editor]")).toBeNull();
	});

	it("keeps text typing local and commits once on change or Enter", async () => {
		const sendPatch = vi
			.spyOn(ws, "sendStateValuePatch")
			.mockImplementation(() => "request-text");
		const doc = makeDoc(
			'<input type="text" data-maket-bind="state.title" data-maket-path="/title" data-maket-type="string" value="Before">',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { title: "Before" },
					revision: 5,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);
		const input = document.querySelector("input") as HTMLInputElement;

		fireEvent.input(input, { target: { value: "Draft" } });
		expect(sendPatch).not.toHaveBeenCalled();

		fireEvent.change(input, { target: { value: "After blur" } });
		expect(sendPatch).toHaveBeenCalledWith("alpha", "/title", 5, "After blur");

		sendPatch.mockClear();
		fireEvent.input(input, { target: { value: "After Enter" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(sendPatch).toHaveBeenCalledTimes(1);
		expect(sendPatch).toHaveBeenCalledWith("alpha", "/title", 5, "After Enter");
		fireEvent.change(input, { target: { value: "After Enter" } });
		expect(sendPatch).toHaveBeenCalledTimes(1);
	});

	it("cancels text edits on Escape and skips unchanged commits", () => {
		const sendPatch = vi.spyOn(ws, "sendStateValuePatch");
		const doc = makeDoc(
			'<input type="text" data-maket-bind="state.title" data-maket-path="/title" data-maket-type="string" value="Before">',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { title: "Before" },
					revision: 5,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);
		const input = document.querySelector("input") as HTMLInputElement;

		fireEvent.input(input, { target: { value: "Discard me" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(input.value).toBe("Before");
		fireEvent.change(input, { target: { value: "Before" } });
		expect(sendPatch).not.toHaveBeenCalled();
	});

	it("patches a native select from its change event", () => {
		const sendPatch = vi
			.spyOn(ws, "sendStateValuePatch")
			.mockImplementation(() => "request-select");
		const doc = makeDoc(
			'<select data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: {
						type: "object",
						properties: {
							status: { type: "string", enum: ["todo", "done"] },
						},
					},
					data: { status: "todo" },
					revision: 6,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		fireEvent.change(document.querySelector("select") as HTMLSelectElement, {
			target: { value: "done" },
		});

		expect(sendPatch).toHaveBeenCalledWith("alpha", "/status", 6, "done");
		expect(document.querySelector("[data-state-value-editor]")).toBeNull();
	});

	it("opens a screen-sized enum listbox and patches without mutating the select", () => {
		const sendPatch = vi
			.spyOn(ws, "sendStateValuePatch")
			.mockImplementation(() => "request-select-popover");
		const doc = makeDoc(
			'<label>État<select aria-label="État" data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select></label>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: {
						type: "object",
						properties: {
							status: { type: "string", enum: ["todo", "done"] },
						},
					},
					data: { status: "todo" },
					revision: 6,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);
		const select = document.querySelector("select") as HTMLSelectElement;

		fireEvent.pointerDown(select, { button: 0 });
		const listbox = screen.getByRole("listbox", { name: "État" });
		expect(listbox.parentElement).toBe(document.body);
		const currentSelect = screen.getByRole("combobox", { name: "État" });
		expect(currentSelect).toHaveAttribute("aria-expanded", "true");
		expect(currentSelect).toHaveAttribute("aria-controls", listbox.id);
		expect(
			within(listbox).getByRole("option", { name: "À faire" }),
		).toHaveAttribute("aria-selected", "true");
		fireEvent.click(within(listbox).getByRole("option", { name: "Fait" }));

		expect(sendPatch).toHaveBeenCalledWith("alpha", "/status", 6, "done");
		expect(screen.getByRole("combobox", { name: "État" })).toHaveValue("todo");
		expect(screen.getByRole("combobox", { name: "État" })).toHaveFocus();
		expect(screen.queryByRole("listbox", { name: "État" })).toBeNull();
	});

	it("supports keyboard enum navigation and restores focus on close or submit", () => {
		const sendPatch = vi
			.spyOn(ws, "sendStateValuePatch")
			.mockImplementation(() => "request-keyboard-enum");
		const doc = makeDoc(
			'<select aria-label="État" data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="partial">Partiel</option><option value="done">Fait</option></select>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { status: "todo" },
					revision: 2,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);
		fireEvent.keyDown(screen.getByRole("combobox", { name: "État" }), {
			key: "ArrowDown",
		});
		const listbox = screen.getByRole("listbox", { name: "État" });
		fireEvent.keyDown(listbox, { key: "End" });
		expect(within(listbox).getByRole("option", { name: "Fait" })).toHaveFocus();
		fireEvent.keyDown(listbox, { key: "Escape" });
		expect(screen.getByRole("combobox", { name: "État" })).toHaveFocus();
		expect(screen.queryByRole("listbox", { name: "État" })).toBeNull();

		fireEvent.keyDown(screen.getByRole("combobox", { name: "État" }), {
			key: "ArrowDown",
		});
		const reopened = screen.getByRole("listbox", { name: "État" });
		fireEvent.keyDown(reopened, { key: "End" });
		fireEvent.keyDown(reopened, { key: "Enter" });
		expect(sendPatch).toHaveBeenCalledWith("alpha", "/status", 2, "done");
		expect(screen.getByRole("combobox", { name: "État" })).toHaveFocus();
		expect(screen.queryByRole("listbox", { name: "État" })).toBeNull();
	});

	it("closes on Tab without cancelling native focus traversal", () => {
		const doc = makeDoc(
			'<select aria-label="État" data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select><button type="button">Après</button>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { status: "todo" },
					revision: 2,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);
		const select = screen.getByRole("combobox", { name: "État" });

		fireEvent.keyDown(select, { key: "ArrowDown" });
		const listbox = screen.getByRole("listbox", { name: "État" });
		const wasNotCancelled = fireEvent.keyDown(listbox, { key: "Tab" });

		expect(wasNotCancelled).toBe(true);
		expect(screen.getByRole("combobox", { name: "État" })).toHaveFocus();
		expect(screen.queryByRole("listbox", { name: "État" })).toBeNull();
	});

	it("anchors repeated enum bindings to the occurrence that was activated", () => {
		const doc = makeDoc(
			'<select aria-label="Premier état" data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select><select aria-label="Second état" data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { status: "todo" },
					revision: 2,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		fireEvent.pointerDown(
			screen.getByRole("combobox", { name: "Second état" }),
			{ button: 0 },
		);
		const listbox = screen.getByRole("listbox", { name: "Second état" });
		fireEvent.keyDown(listbox, { key: "Escape" });

		expect(screen.getByRole("combobox", { name: "Second état" })).toHaveFocus();
	});

	it("blocks the enum popover while read-only", () => {
		const doc = makeDoc(
			'<select aria-label="État" data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select>',
		);
		doc.dataModel = "state";
		useStore.setState({
			readOnly: true,
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { status: "todo" },
					revision: 2,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);
		const select = document.querySelector("select") as HTMLSelectElement;

		fireEvent.pointerDown(select, { button: 0 });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(select).toHaveValue("todo");
	});

	it("keeps native state controls locally interactive in the read-only viewer", () => {
		const sendPatch = vi.spyOn(ws, "sendStateValuePatch");
		const doc = makeDoc(
			'<input type="checkbox" data-maket-bind="state.done" data-maket-path="/done" data-maket-type="boolean" checked><select data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo">À faire</option><option value="ready" selected>Prêt</option></select>',
		);
		doc.dataModel = "state";
		useStore.setState({
			readOnly: true,
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { done: true, status: "ready" },
					revision: 1,
					createdAt: "2026-08-07T00:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		const checkbox = document.querySelector(
			'input[type="checkbox"]',
		) as HTMLInputElement;
		const select = document.querySelector("select") as HTMLSelectElement;
		fireEvent.change(checkbox, { target: { checked: false } });
		fireEvent.change(select, { target: { value: "todo" } });

		expect(checkbox).not.toBeChecked();
		expect(select).toHaveValue("todo");
		expect(sendPatch).not.toHaveBeenCalled();
	});

	it("edits one bound string through the small value editor", async () => {
		const sendPatch = vi
			.spyOn(ws, "sendStateValuePatch")
			.mockImplementation(() => "request-2");
		const doc = makeDoc(
			'<p data-id="a"><button type="button" data-maket-bind="state.title" data-maket-path="/title" data-maket-type="string">Before</button></p>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { title: "Before" },
					revision: 7,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "{{ state.title }}" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		await act(async () => {
			fireEvent.click(
				document.querySelector("[data-maket-bind]") as HTMLElement,
			);
		});
		const input = document.querySelector(
			"#maket-state-value",
		) as HTMLInputElement;
		expect(input).not.toBeNull();
		fireEvent.change(input, { target: { value: "After" } });
		fireEvent.submit(
			document.querySelector("[data-state-value-editor]") as HTMLFormElement,
		);

		expect(sendPatch).toHaveBeenCalledWith("alpha", "/title", 7, "After");
		expect(document.querySelector("[data-state-value-editor]")).toBeNull();
	});

	it("edits a boolean button through the same single-value editor", async () => {
		const sendPatch = vi
			.spyOn(ws, "sendStateValuePatch")
			.mockImplementation(() => "request-boolean");
		const doc = makeDoc(
			'<button type="button" data-maket-bind="state.done" data-maket-path="/done" data-maket-type="boolean">Edit</button>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { done: true },
					revision: 8,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		fireEvent.click(document.querySelector("[data-maket-bind]") as HTMLElement);
		const editorInput = document.querySelector(
			"#maket-state-value",
		) as HTMLInputElement;
		expect(editorInput).toBeChecked();
		fireEvent.click(editorInput);
		fireEvent.submit(
			document.querySelector("[data-state-value-editor]") as HTMLFormElement,
		);

		expect(sendPatch).toHaveBeenCalledWith("alpha", "/done", 8, false);
	});

	it("exposes pending and error hooks and restores a failed checkbox", async () => {
		const doc = makeDoc(
			'<label data-id="a"><input type="checkbox" data-maket-bind="state.done" data-maket-path="/done" data-maket-type="boolean"></label>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { done: false },
					revision: 4,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);
		let input = document.querySelector("input") as HTMLInputElement;
		input.checked = true;

		act(() => useStore.getState().beginStatePatch(doc.name, "/done", "r1"));
		input = document.querySelector("input") as HTMLInputElement;
		expect(input).toHaveAttribute("data-maket-pending");

		act(() => useStore.getState().settleStatePatch("r1", "revision conflict"));
		input = document.querySelector("input") as HTMLInputElement;
		expect(input).not.toBeChecked();
		expect(input).toHaveAttribute("data-maket-error", "revision conflict");
		expect(useStore.getState().statePatchErrors).toEqual({
			[statePatchKey(doc.name, "/done")]: "revision conflict",
		});
	});

	it("blocks every live control while one document patch is pending", () => {
		const sendPatch = vi.spyOn(ws, "sendStateValuePatch");
		const doc = makeDoc(
			'<input type="text" data-maket-bind="state.title" data-maket-path="/title" data-maket-type="string" value="Before"><select data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { title: "Before", status: "todo" },
					revision: 4,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		const { container } = render(
			<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />,
		);

		act(() =>
			useStore.getState().beginStatePatch(doc.name, "/title", "r-title"),
		);
		const select = container.querySelector("select") as HTMLSelectElement;
		fireEvent.pointerDown(select, { button: 0 });
		fireEvent.change(select, { target: { value: "done" } });

		expect(sendPatch).not.toHaveBeenCalled();
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(select.value).toBe("todo");
		expect(container.querySelector(".page-canvas")).toHaveAttribute("inert");
		expect(container.querySelector(".page-canvas")).toHaveAttribute(
			"aria-busy",
			"true",
		);
	});

	it("restores failed text and select controls from authoritative state", () => {
		const doc = makeDoc(
			'<input type="text" data-maket-bind="state.title" data-maket-path="/title" data-maket-type="string" value="Before"><select data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select>',
		);
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { title: "Before", status: "todo" },
					revision: 4,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: { [doc.pages[0]?.id ?? ""]: "" },
				},
			},
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);
		let input = document.querySelector("input") as HTMLInputElement;
		let select = document.querySelector("select") as HTMLSelectElement;
		input.value = "Draft";
		select.value = "done";

		act(() => useStore.getState().beginStatePatch(doc.name, "/title", "rt"));
		act(() => useStore.getState().settleStatePatch("rt", "invalid title"));
		act(() => useStore.getState().beginStatePatch(doc.name, "/status", "rs"));
		act(() => useStore.getState().settleStatePatch("rs", "revision conflict"));

		input = document.querySelector("input") as HTMLInputElement;
		select = document.querySelector("select") as HTMLSelectElement;
		expect(input.value).toBe("Before");
		expect(select.value).toBe("todo");
		expect(input).toHaveAttribute("data-maket-error", "invalid title");
		expect(select).toHaveAttribute("data-maket-error", "revision conflict");
	});

	it("renders and edits the raw Mustache template in design mode", async () => {
		const doc = makeDoc('<p data-id="a">Rendered title</p>');
		doc.dataModel = "state";
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { title: "Rendered title" },
					revision: 1,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: {
						[doc.pages[0]?.id ?? ""]: '<p data-id="a">{{ state.title }}</p>',
					},
				},
			},
			stateCanvasModes: { [doc.name]: "design" },
		});
		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		const target = document.querySelector('[data-id="a"]') as HTMLElement;
		expect(target.textContent).toContain("{{ state.title }}");
		await act(async () => fireEvent.click(target));
		expect(document.querySelector(".element-toolbar")).not.toBeNull();
		expect(document.querySelector(".element-toolbar select")).toBeNull();
	});

	it("keeps a locked living document passive in both modes", async () => {
		const sendPatch = vi.spyOn(ws, "sendStateValuePatch");
		const doc = makeDoc(
			'<label data-id="a"><input type="checkbox" data-maket-bind="state.done" data-maket-path="/done" data-maket-type="boolean"><select aria-label="État" data-maket-bind="state.status" data-maket-path="/status" data-maket-type="string"><option value="todo" selected>À faire</option><option value="done">Fait</option></select></label>',
		);
		doc.dataModel = "state";
		doc.meta = { locked: true };
		useStore.setState({
			documentStates: {
				[doc.name]: {
					schema: { type: "object" },
					data: { done: false, status: "todo" },
					revision: 1,
					createdAt: "2026-08-04T12:00:00.000Z",
					templates: {
						[doc.pages[0]?.id ?? ""]: '<p data-id="a">{{ state.done }}</p>',
					},
				},
			},
		});
		const { rerender } = render(
			<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />,
		);

		await act(async () =>
			fireEvent.change(document.querySelector("input") as HTMLInputElement, {
				target: { checked: true },
			}),
		);
		fireEvent.pointerDown(
			document.querySelector("select") as HTMLSelectElement,
			{ button: 0 },
		);
		expect(sendPatch).not.toHaveBeenCalled();
		expect(screen.queryByRole("listbox")).toBeNull();

		useStore.getState().setStateCanvasMode(doc.name, "design");
		rerender(
			<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />,
		);
		await act(async () =>
			fireEvent.click(document.querySelector('[data-id="a"]') as HTMLElement),
		);
		expect(document.querySelector(".element-toolbar")).toBeNull();
	});

	it("marks placeholders on collection-bound pages", () => {
		const doc = makeDoc('<p data-id="a">{{ client_name }}</p>');
		doc.pages[0].collection = { name: "clients" };

		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		const marker = document.querySelector("[data-collection-placeholder]");
		expect(marker?.getAttribute("data-collection-placeholder")).toBe(
			"client_name",
		);
		expect(marker?.getAttribute("data-collection-bound")).toBe("true");
	});

	it("renders the selected collection row in rendered preview mode", () => {
		const doc = makeDoc('<p data-id="a">{{ client_name }}</p>');
		doc.pages[0].collection = { name: "clients" };
		const collection = makeCollection({ client_name: "Acme" });

		render(
			<PageCanvas
				doc={doc}
				pageIndex={0}
				charteCss=""
				focused={true}
				collection={collection}
				preview={{
					mode: "rendered",
					memberId: "member_1",
					memberNumber: 1,
					memberTotal: 1,
					pageNumber: 1,
					pageTotal: 1,
				}}
			/>,
		);

		expect(document.querySelector('[data-id="a"]')?.textContent).toBe("Acme");
	});

	it("does not offer text editing on rendered collection rows", async () => {
		const doc = makeDoc('<p data-id="a">{{ client_name }}</p>');
		doc.pages[0].collection = { name: "clients" };
		const collection = makeCollection({ client_name: "Acme" });

		render(
			<PageCanvas
				doc={doc}
				pageIndex={0}
				charteCss=""
				focused={true}
				collection={collection}
				preview={{
					mode: "rendered",
					memberId: "member_1",
					memberNumber: 1,
					memberTotal: 1,
					pageNumber: 1,
					pageTotal: 1,
				}}
			/>,
		);

		await act(async () => {
			fireEvent.click(document.querySelector('[data-id="a"]') as HTMLElement);
		});

		expect(document.querySelector(".tb-edit")).toBeNull();
		expect(document.querySelector(".element-toolbar select")).toBeNull();
		expect(document.querySelector(".tb-comment")).not.toBeNull();
	});

	it("shows placeholder errors instead of silently falling back", () => {
		const doc = makeDoc('<p data-id="a">{{ missing_field }}</p>');
		doc.pages[0].collection = { name: "clients" };
		const collection = makeCollection({ client_name: "Acme" });

		render(
			<PageCanvas
				doc={doc}
				pageIndex={0}
				charteCss=""
				focused={true}
				collection={collection}
				preview={{
					mode: "rendered",
					memberId: "member_1",
					memberNumber: 1,
					memberTotal: 1,
					pageNumber: 1,
					pageTotal: 1,
				}}
			/>,
		);

		expect(document.body.textContent).toContain("Unknown collection field");
	});

	it("shows comment-only toolbar for non-editable elements", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<img data-id="hero" src="/assets/photo.jpg" />')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(
				document.querySelector('[data-id="hero"]') as HTMLElement,
			);
		});

		expect(document.querySelector(".tb-comment")).not.toBeNull();
		expect(document.querySelector(".tb-edit")).toBeNull();
	});

	it("dismisses the toolbar when clicking outside the canvas", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">Editable</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(document.querySelector('[data-id="a"]') as HTMLElement);
		});
		expect(document.querySelector(".element-toolbar")).not.toBeNull();

		await act(async () => {
			fireEvent.click(document.body);
		});
		expect(document.querySelector(".element-toolbar")).toBeNull();
	});

	it("comment action opens the popover state for the selected element", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">Editable</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(document.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-comment") as HTMLElement);
		});

		expect(useStore.getState().showPopover).toBe(true);
		expect(useStore.getState().selectedIds).toEqual(["a"]);
	});
});

function makeDoc(html: string, marginUniform?: number): Document {
	return {
		id: "id-alpha",
		name: "alpha",
		category: "flyer",
		canvas: {
			w: 210,
			h: 297,
			background: "#fff",
			...(marginUniform != null
				? {
						margins: {
							top: marginUniform,
							right: marginUniform,
							bottom: marginUniform,
							left: marginUniform,
						},
					}
				: {}),
		},
		pages: [{ id: `${name}-page-1`, name: "p1", elements: [], html }],
		activePage: 0,
	};
}

function makeCollection(data: Record<string, string>): Collection {
	return {
		name: "clients",
		schema: {
			type: "object",
			properties: { client_name: { type: "string" } },
			required: ["client_name"],
			additionalProperties: false,
		},
		members: [
			{
				id: "member_1",
				position: 0,
				data,
			},
		],
	};
}

describe("parseCSSVars", () => {
	it("extracts CSS custom properties into a map", () => {
		const css = `:root {
			--charte-color-primary: #ff0000;
			--charte-font-heading: 'Inter', sans-serif;
			color: red;
		}`;
		expect(parseCSSVars(css)).toEqual({
			"--charte-color-primary": "#ff0000",
			"--charte-font-heading": "'Inter', sans-serif",
		});
	});

	it("returns {} for empty input", () => {
		expect(parseCSSVars("")).toEqual({});
	});

	it("trims values", () => {
		expect(parseCSSVars("--x:   42px   ;")).toEqual({ "--x": "42px" });
	});
});

describe("isTextEditable", () => {
	function el(html: string): HTMLElement {
		const div = document.createElement("div");
		div.innerHTML = html;
		return div.firstElementChild as HTMLElement;
	}

	it("returns false for non-editable tags", () => {
		expect(isTextEditable(el("<img />"))).toBe(false);
		expect(isTextEditable(el("<svg></svg>"))).toBe(false);
		expect(isTextEditable(el("<iframe></iframe>"))).toBe(false);
	});

	it("returns false when data-noedit is present", () => {
		expect(isTextEditable(el('<div data-noedit="">hi</div>'))).toBe(false);
	});

	it("returns true for leaf elements carrying text", () => {
		expect(isTextEditable(el("<p>hello</p>"))).toBe(true);
	});

	it("returns false for containers whose only children are data-id elements", () => {
		const host = el(
			'<section><div data-id="a">inner</div><div data-id="b">inner</div></section>',
		);
		expect(isTextEditable(host)).toBe(false);
	});

	it("returns true when container mixes data-id children with other markup", () => {
		const host = el(
			'<section><span>mix</span><div data-id="a">inner</div></section>',
		);
		expect(isTextEditable(host)).toBe(true);
	});
});

describe("PageCanvas rendering", () => {
	it("rewrites /assets/* image sources to /assets/preview/*", () => {
		const html = `<img src="/assets/hero.jpg" data-id="h" />`;
		const { container } = render(
			<PageCanvas
				doc={makeDoc(html)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("/assets/preview/hero.jpg");
	});

	it("does not rewrite already-normalized preview/thumb/print paths", () => {
		const html = `
			<img src="/assets/preview/a.jpg" data-id="a" />
			<img src="/assets/thumb/b.jpg" data-id="b" />
			<img src="/assets/print/c.jpg" data-id="c" />
		`;
		const { container } = render(
			<PageCanvas
				doc={makeDoc(html)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		const srcs = [...container.querySelectorAll("img")].map((i) =>
			i.getAttribute("src"),
		);
		expect(srcs).toEqual([
			"/assets/preview/a.jpg",
			"/assets/thumb/b.jpg",
			"/assets/print/c.jpg",
		]);
	});

	it("renders a margin guide only when canvas.margins is set", () => {
		const noMargin = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">x</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		expect(noMargin.container.querySelector(".margin-guide")).toBeNull();
		noMargin.unmount();

		const withMargin = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">x</p>', 10)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		expect(withMargin.container.querySelector(".margin-guide")).not.toBeNull();
	});

	it("applies charte CSS variables as inline styles on the page-canvas root", () => {
		const { container } = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">x</p>')}
				pageIndex={0}
				charteCss=":root { --charte-color-primary: #00ff00; }"
				focused={true}
			/>,
		);
		const root = container.querySelector(".page-canvas") as HTMLElement;
		expect(root.style.getPropertyValue("--charte-color-primary")).toBe(
			"#00ff00",
		);
	});
});

describe("PageCanvas pending flags", () => {
	it("adds flagged-delete / has-note classes for matching element ids", async () => {
		const html = `
			<p data-id="a">A</p>
			<p data-id="b">B</p>
			<p data-id="c">C</p>
		`;
		const { container } = render(
			<PageCanvas
				doc={makeDoc(html)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			useStore.setState({
				pending: [
					{ id: "m1", type: "delete", elementId: "a", ts: 0 },
					{ id: "m2", type: "note", elementId: "b", ts: 0 },
				],
			});
		});

		const a = container.querySelector('[data-id="a"]') as HTMLElement;
		const b = container.querySelector('[data-id="b"]') as HTMLElement;
		const c = container.querySelector('[data-id="c"]') as HTMLElement;
		expect(a.classList.contains("flagged-delete")).toBe(true);
		expect(a.classList.contains("has-note")).toBe(false);
		expect(b.classList.contains("has-note")).toBe(true);
		expect(b.classList.contains("flagged-delete")).toBe(false);
		expect(c.classList.contains("flagged-delete")).toBe(false);
		expect(c.classList.contains("has-note")).toBe(false);
	});

	it("clears flags when the pending entry is removed", async () => {
		const html = `<p data-id="a">A</p>`;
		const { container } = render(
			<PageCanvas
				doc={makeDoc(html)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		const getA = () => container.querySelector('[data-id="a"]') as HTMLElement;

		await act(async () => {
			useStore.setState({
				pending: [{ id: "m1", type: "delete", elementId: "a", ts: 0 }],
			});
		});
		expect(getA().classList.contains("flagged-delete")).toBe(true);

		await act(async () => {
			useStore.setState({ pending: [] });
		});
		expect(getA().classList.contains("flagged-delete")).toBe(false);
	});
});

describe("PageCanvas edit mode", () => {
	it("starts inline editing from the toolbar for editable elements", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">original</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(document.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-edit") as HTMLElement);
		});
		await act(async () => {
			vi.runAllTimers();
		});

		expect(useStore.getState().editingElementId).toBe("a");
		expect(
			document.querySelector(".page-canvas")?.classList.contains("is-editing"),
		).toBe(true);
	});

	it("Escape cancels editing and restores the original html", async () => {
		const { container } = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">original</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(container.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-edit") as HTMLElement);
		});
		await act(async () => {
			vi.runAllTimers();
		});
		const target = container.querySelector('[data-id="a"]') as HTMLElement;
		target.innerHTML = "<strong>mutated</strong>";

		await act(async () => {
			fireEvent.keyDown(target, { key: "Escape" });
		});

		expect(target.innerHTML).toBe("original");
		expect(useStore.getState().editingElementId).toBeNull();
	});

	it("blur with unchanged html exits edit mode without sending a patch", async () => {
		const sendTextEdit = vi.spyOn(ws, "sendTextEdit");
		const { container } = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">original</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(container.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-edit") as HTMLElement);
		});
		await act(async () => {
			vi.runAllTimers();
		});
		const target = container.querySelector('[data-id="a"]') as HTMLElement;

		await act(async () => {
			fireEvent.blur(target);
		});

		expect(sendTextEdit).not.toHaveBeenCalled();
		expect(useStore.getState().editingElementId).toBeNull();
	});

	it("blur with changed html sends a text edit for the current doc/page/id", async () => {
		const sendTextEdit = vi
			.spyOn(ws, "sendTextEdit")
			.mockImplementation(() => {});
		const { container } = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">original</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(container.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-edit") as HTMLElement);
		});
		await act(async () => {
			vi.runAllTimers();
		});
		const target = container.querySelector('[data-id="a"]') as HTMLElement;
		target.innerHTML = "<em>changed</em>";

		await act(async () => {
			fireEvent.blur(target);
		});

		expect(sendTextEdit).toHaveBeenCalledWith(
			"alpha",
			0,
			"a",
			"<em>changed</em>",
		);
		expect(useStore.getState().editingElementId).toBe("a");
	});

	it("clears editingElementId when a server broadcast replaces the html", async () => {
		const doc1 = makeDoc('<p data-id="a">original</p>');
		const { rerender } = render(
			<PageCanvas doc={doc1} pageIndex={0} charteCss="" focused={true} />,
		);

		await act(async () => {
			useStore.setState({ editingElementId: "a" });
		});
		expect(useStore.getState().editingElementId).toBe("a");

		const doc2 = makeDoc('<p data-id="a">from server</p>');
		await act(async () => {
			rerender(
				<PageCanvas doc={doc2} pageIndex={0} charteCss="" focused={true} />,
			);
		});
		expect(useStore.getState().editingElementId).toBeNull();
	});

	it("does not clear editingElementId while rawHtml is unchanged", async () => {
		const doc1 = makeDoc('<p data-id="a">original</p>');
		const { rerender } = render(
			<PageCanvas doc={doc1} pageIndex={0} charteCss="" focused={true} />,
		);

		await act(async () => {
			useStore.setState({ editingElementId: "a" });
		});

		await act(async () => {
			rerender(
				<PageCanvas doc={doc1} pageIndex={0} charteCss="" focused={true} />,
			);
		});
		expect(useStore.getState().editingElementId).toBe("a");
	});
});
