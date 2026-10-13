import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { AnnotationToggle } from "./AnnotationToggle";
import { Popover } from "./Popover";
import { ReaderSurface, ReadingWorkspace } from "./ReadingWorkspace";

const initial = useStore.getState();
function documentFixture(name: string): Document {
	return {
		id: name,
		name,
		category: "Simulation",
		dataModel: "state",
		canvas: { w: 168, h: 1, format: "AUTO", background: "#fff" },
		activePage: 0,
		pages: [
			{
				id: `${name}-page`,
				name: "Detail",
				elements: [],
				html: '<p data-id="body">Discussion</p><a data-id="card" data-maket-action="open-document" data-maket-document="Other document" href="/documents/other/read">Source document</a>',
			},
		],
	};
}
beforeEach(() => {
	setLang("en");
	localStorage.clear();
	useStore.setState({
		...initial,
		connected: true,
		readOnly: false,
		annotationDocName: null,
		documentStates: {},
		pending: [],
		collections: [],
		chartesCss: new Map(),
	});
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useStore.setState(initial);
});

describe("Annotation tool in Reader", () => {
	it.each(["locked", "read-only"])(
		"closes an open annotation when access becomes %s",
		async (access) => {
			const doc = documentFixture("Access transition");
			useStore.setState({
				docs: new Map([[doc.name, doc]]),
				workspaceDocNames: [doc.name],
				focusedDocName: doc.name,
				focusedPageIndex: 0,
			});
			const user = userEvent.setup();
			render(<ReadingWorkspace />);
			await user.click(screen.getByRole("button", { name: "Annotate" }));
			await user.click(screen.getByText("Discussion"));
			expect(
				screen.getByRole("dialog", { name: "Message to the agent" }),
			).toBeVisible();
			act(() =>
				useStore.setState(
					access === "locked"
						? {
								docs: new Map([[doc.name, { ...doc, meta: { locked: true } }]]),
							}
						: { readOnly: true },
				),
			);
			expect(screen.queryByRole("dialog")).toBeNull();
			expect(screen.queryByRole("button", { name: "Annotate" })).toBeNull();
			expect(useStore.getState().selectedIds).toEqual([]);
		},
	);
	it("toggles annotations, saves a note against the real document, then restores card navigation", async () => {
		const doc = documentFixture("Meeting");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 0,
		});
		const save = vi
			.spyOn(useStore.getState(), "addPending")
			.mockResolvedValue({ ok: true });
		const open = vi
			.spyOn(useStore.getState(), "openWorkspaceDocument")
			.mockImplementation(() => {});
		const user = userEvent.setup();
		const { container } = render(<ReadingWorkspace />);
		const toggle = screen.getByRole("button", { name: "Annotate" });
		expect(toggle).toHaveAttribute("aria-pressed", "false");
		await user.click(toggle);
		expect(toggle).toHaveAttribute("aria-pressed", "true");
		await user.click(screen.getByText("Source document"));
		expect(open).not.toHaveBeenCalled();
		expect(
			screen.getByRole("dialog", { name: "Message to the agent" }),
		).toBeVisible();
		expect(container.querySelector('[data-id="card"]')).not.toHaveAttribute(
			"contenteditable",
			"true",
		);
		await user.type(screen.getByRole("textbox"), "Clarify this source");
		await user.click(screen.getByRole("button", { name: "Send message" }));
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "note",
				docName: "Meeting",
				pageIndex: 0,
				elementId: "card",
				text: "Clarify this source",
			}),
		);
		await user.click(toggle);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(container.querySelector(".is-annotating")).toBeNull();
		await user.click(screen.getByText("Source document"));
		expect(open).toHaveBeenCalledWith("Other document");
	});

	it("targets the correct pane when two documents share element ids, including keyboard activation", async () => {
		const left = documentFixture("Index");
		const right = documentFixture("Detail");
		useStore.setState({
			docs: new Map([
				[left.name, left],
				[right.name, right],
			]),
			workspaceDocNames: [left.name, right.name],
			focusedDocName: left.name,
			focusedPageIndex: 0,
		});
		const user = userEvent.setup();
		render(
			<>
				<AnnotationToggle doc={right} />
				<section aria-label="Left">
					<ReaderSurface
						doc={left}
						dataSource="connected"
						onNavigatePage={() => {}}
					/>
				</section>
				<section aria-label="Right">
					<ReaderSurface
						doc={right}
						dataSource="connected"
						onNavigatePage={() => {}}
					/>
				</section>
				<Popover />
			</>,
		);
		await user.click(screen.getByRole("button", { name: "Annotate" }));
		const source = within(
			screen.getByRole("region", { name: "Right" }),
		).getByText("Source document");
		act(() => {
			fireEvent.keyDown(source, { key: "Enter" });
		});
		expect(useStore.getState().focusedDocName).toBe("Detail");
		expect(
			screen.getByRole("dialog", { name: "Message to the agent" }),
		).toHaveTextContent("Detail");
		expect(
			screen
				.getByRole("region", { name: "Left" })
				.querySelector(".is-annotating"),
		).toBeNull();
		await user.click(screen.getByRole("button", { name: "Annotate" }));
		expect(useStore.getState().selectedIds).toEqual([]);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("anchors a multi-line message to the page under the pointer, sends on Enter and shows the sent state", async () => {
		const doc = documentFixture("Page anchor");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 0,
		});
		const save = vi
			.spyOn(useStore.getState(), "addPending")
			.mockResolvedValue({ ok: true });
		const user = userEvent.setup();
		const { container } = render(<ReadingWorkspace />);
		await user.click(screen.getByRole("button", { name: "Annotate" }));
		const page = container.querySelector<HTMLElement>(".page-canvas");
		expect(page).not.toBeNull();
		expect(page).toHaveAttribute("tabindex", "0");
		expect(container.querySelector('[data-id="body"]')).toHaveAttribute(
			"tabindex",
			"0",
		);
		act(() => {
			fireEvent.click(page as HTMLElement, { clientX: 40, clientY: 60 });
		});
		const dialog = screen.getByRole("dialog", { name: "Message to the agent" });
		expect(dialog).toHaveTextContent("Page anchor · Detail");
		expect(dialog).toHaveTextContent("Whole page");
		expect(page).toHaveAttribute("data-message-anchor", "");
		expect(
			container.querySelector("[data-annotation-compose-pin]"),
		).not.toBeNull();
		const field = screen.getByPlaceholderText("Message for the agent");
		expect(field).toHaveFocus();
		await user.type(field, "Line one{Shift>}{Enter}{/Shift}Line two");
		expect(field).toHaveValue("Line one\nLine two");
		expect(save).not.toHaveBeenCalled();
		await user.keyboard("{Enter}");
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "note",
				docName: "Page anchor",
				pageIndex: 0,
				text: "Line one\nLine two",
			}),
		);
		expect(save.mock.calls[0]?.[0]).not.toHaveProperty("elementId");
		expect(
			await within(dialog).findByText(
				"Sent · pending until the agent reads it",
			),
		).toHaveAttribute("role", "status");
	});

	it("cancels with Escape and reaches elements from the keyboard", async () => {
		const doc = documentFixture("Keyboard");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 0,
		});
		const save = vi
			.spyOn(useStore.getState(), "addPending")
			.mockResolvedValue({ ok: true });
		const user = userEvent.setup();
		const { container } = render(<ReadingWorkspace />);
		await user.click(screen.getByRole("button", { name: "Annotate" }));
		const body = container.querySelector<HTMLElement>('[data-id="body"]');
		act(() => body?.focus());
		await user.keyboard("{Enter}");
		const dialog = screen.getByRole("dialog", { name: "Message to the agent" });
		expect(dialog).toHaveTextContent("Discussion");
		expect(useStore.getState().messageAnchor).toEqual({
			docName: "Keyboard",
			pageIndex: 0,
			elementId: "body",
		});
		await user.type(screen.getByRole("textbox"), "Draft");
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(save).not.toHaveBeenCalled();
		expect(body).toHaveFocus();
		expect(container.querySelector(".is-annotating")).not.toBeNull();
	});

	it.each(["read-only", "locked"])(
		"does not expose the tool for %s documents",
		(access) => {
			const doc = documentFixture("Restricted");
			if (access === "locked") doc.meta = { locked: true };
			useStore.setState({ readOnly: access === "read-only" });
			render(<AnnotationToggle doc={doc} />);
			expect(screen.queryByRole("button", { name: "Annotate" })).toBeNull();
		},
	);
});
