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
			expect(screen.getByRole("dialog", { name: "Comment" })).toBeVisible();
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
		expect(screen.getByRole("dialog", { name: "Comment" })).toBeVisible();
		expect(container.querySelector('[data-id="card"]')).not.toHaveAttribute(
			"contenteditable",
			"true",
		);
		await user.type(screen.getByRole("textbox"), "Clarify this source");
		await user.click(screen.getByRole("button", { name: "Send note" }));
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
		expect(screen.getByRole("dialog", { name: "Comment" })).toHaveTextContent(
			"Detail",
		);
		expect(
			screen
				.getByRole("region", { name: "Left" })
				.querySelector(".is-annotating"),
		).toBeNull();
		await user.click(screen.getByRole("button", { name: "Annotate" }));
		expect(useStore.getState().selectedIds).toEqual([]);
		expect(screen.queryByRole("dialog")).toBeNull();
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
