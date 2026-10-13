import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { MessagesPanel } from "./MessagesPanel";

const zoomSpies = vi.hoisted(() => ({ requestFit: vi.fn() }));

vi.mock("../store/zoomBridge", () => ({
	requestFit: zoomSpies.requestFit,
}));

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "tests",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-page-1`, name: "p1", elements: [] }],
		activePage: 0,
	};
}

beforeEach(() => {
	setLang("en");
	zoomSpies.requestFit.mockReset();
	useStore.setState({
		focusedDocName: null,
		docs: new Map([
			["Alpha document", makeDoc("Alpha document")],
			["Beta document", makeDoc("Beta document")],
		]),
		workspaceDocNames: [],
		libraryOpen: true,
		libraryView: "exchange",
		pending: [
			{
				id: "alpha",
				type: "note",
				text: "Review the Alpha layout",
				docName: "Alpha document",
				ts: 1,
			},
			{
				id: "beta",
				type: "note",
				text: "Review the Beta copy",
				docName: "Beta document",
				ts: 2,
			},
		],
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("MessagesPanel", () => {
	it("filters exchanges through the shared library search", async () => {
		const user = userEvent.setup();
		render(<MessagesPanel />);

		await user.type(
			screen.getByRole("textbox", { name: "Search exchanges…" }),
			"Beta",
		);
		expect(
			screen.queryByText("Review the Alpha layout"),
		).not.toBeInTheDocument();
		expect(screen.getByText("Review the Beta copy")).toBeVisible();

		await user.click(screen.getByRole("button", { name: "Clear search" }));
		expect(screen.getByText("Review the Alpha layout")).toBeVisible();
	});

	it("uses compact target and delete actions instead of ambiguous labels", () => {
		render(<MessagesPanel />);

		const openButtons = screen.getAllByRole("button", { name: "Open target" });
		expect(openButtons).toHaveLength(2);
		expect(openButtons[0]?.querySelector(".lucide-eye")).not.toBeNull();
		expect(
			screen.getAllByRole("button", { name: "Delete message" }),
		).toHaveLength(2);
		expect(screen.queryByText("View")).not.toBeInTheDocument();
		expect(screen.queryByText("Resolve")).not.toBeInTheDocument();
	});

	it("keeps the exchanges panel open when revealing a message target", async () => {
		const user = userEvent.setup();
		render(<MessagesPanel />);

		await user.click(screen.getAllByRole("button", { name: "Open target" })[0]);

		expect(useStore.getState()).toMatchObject({
			libraryOpen: true,
			libraryView: "exchange",
			focusedDocName: "Alpha document",
		});
		expect(zoomSpies.requestFit).toHaveBeenCalledWith({
			docName: "Alpha document",
			pageIndex: 0,
		});
	});

	it("clears a document highlight when its message disappears under the pointer", async () => {
		const user = userEvent.setup();
		const doc = document.createElement("div");
		doc.dataset.doc = "Alpha document";
		document.body.append(doc);

		try {
			render(<MessagesPanel />);
			const card = screen
				.getByText("Review the Alpha layout")
				.closest("article");
			expect(card).not.toBeNull();
			await user.hover(card as HTMLElement);
			expect(doc).toHaveAttribute("data-maket-message-target");

			useStore.setState((state) => ({
				pending: state.pending.filter((message) => message.id !== "alpha"),
			}));

			await waitFor(() =>
				expect(doc).not.toHaveAttribute("data-maket-message-target"),
			);
		} finally {
			doc.remove();
		}
	});

	it("lets the board camera center the target without competing DOM scrolling", async () => {
		const user = userEvent.setup();
		const scrollIntoView = vi.fn();
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
		HTMLElement.prototype.scrollIntoView = scrollIntoView;
		const doc = document.createElement("div");
		doc.dataset.doc = "Alpha document";
		document.body.append(doc);

		try {
			render(<MessagesPanel />);
			await user.click(
				screen.getAllByRole("button", { name: "Open target" })[0],
			);

			expect(scrollIntoView).not.toHaveBeenCalled();
			expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
				docName: "Alpha document",
				pageIndex: 0,
			});
		} finally {
			HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
			doc.remove();
		}
	});

	it("edits a note in place with Enter, cancels with Escape, and shows the edit time", async () => {
		const user = userEvent.setup();
		const edit = vi
			.spyOn(useStore.getState(), "editPending")
			.mockResolvedValue({ ok: true });
		render(<MessagesPanel />);
		const card = screen
			.getByText("Review the Alpha layout")
			.closest("article") as HTMLElement;

		await user.click(
			within(card).getByRole("button", { name: "Edit message" }),
		);
		const field = within(card).getByRole("textbox", { name: "Edit message" });
		expect(field).toHaveValue("Review the Alpha layout");
		expect(field).toHaveFocus();
		await user.keyboard("{Escape}");
		expect(within(card).queryByRole("textbox")).toBeNull();
		expect(edit).not.toHaveBeenCalled();

		await user.click(
			within(card).getByRole("button", { name: "Edit message" }),
		);
		const again = within(card).getByRole("textbox", { name: "Edit message" });
		await user.clear(again);
		await user.type(again, "Tighten{Shift>}{Enter}{/Shift}the grid{Enter}");
		expect(edit).toHaveBeenCalledWith("alpha", "Tighten\nthe grid");
		await waitFor(() => expect(within(card).queryByRole("textbox")).toBeNull());

		useStore.setState((state) => ({
			pending: state.pending.map((message) =>
				message.id === "alpha"
					? {
							...message,
							text: "Tighten\nthe grid",
							edited: true,
							editedAt: new Date(2026, 9, 13, 14, 5).getTime(),
						}
					: message,
			),
		}));
		expect(await within(card).findByText("edited 14:05")).toHaveAttribute(
			"data-message-edited",
		);
	});

	it("shows the server refusal when the agent already acknowledged the message", async () => {
		const user = userEvent.setup();
		vi.spyOn(useStore.getState(), "editPending").mockResolvedValue({
			ok: false,
			error: "This message was already handled by the agent or deleted.",
		});
		render(<MessagesPanel />);
		const card = screen
			.getByText("Review the Beta copy")
			.closest("article") as HTMLElement;
		await user.click(
			within(card).getByRole("button", { name: "Edit message" }),
		);
		await user.type(within(card).getByRole("textbox"), " now{Enter}");
		expect(await within(card).findByRole("alert")).toHaveTextContent(
			"This message was already handled by the agent or deleted.",
		);
	});

	it("deletes a message only after holding the confirmation", async () => {
		const user = userEvent.setup();
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		HTMLElement.prototype.setPointerCapture = vi.fn();
		const remove = vi
			.spyOn(useStore.getState(), "removePending")
			.mockReturnValue(true);
		render(<MessagesPanel />);
		const card = screen
			.getByText("Review the Beta copy")
			.closest("article") as HTMLElement;

		await user.click(
			within(card).getByRole("button", { name: "Delete message" }),
		);
		expect(remove).not.toHaveBeenCalled();
		const hold = within(card).getByRole("button", {
			name: "Hold to delete",
		});
		fireEvent.pointerDown(hold, { pointerId: 1 });
		frames.shift()?.(0);
		frames.shift()?.(700);
		expect(remove).toHaveBeenCalledWith("beta");
	});

	it("jumps to the anchor of every entry, including workspace requests", async () => {
		const user = userEvent.setup();
		useStore.setState({
			pending: [
				{
					id: "page-note",
					type: "note",
					text: "Whole page remark",
					docName: "Beta document",
					pageIndex: 0,
					ts: 3,
				},
				{
					id: "images",
					type: "classify-images",
					text: "2 new images",
					ts: 4,
				},
			],
		});
		render(<MessagesPanel />);

		await user.click(screen.getByRole("button", { name: /Beta document/ }));
		expect(useStore.getState().focusedDocName).toBe("Beta document");
		expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
			docName: "Beta document",
			pageIndex: 0,
		});

		const workspaceCard = screen
			.getByText("2 new images")
			.closest("article") as HTMLElement;
		expect(
			within(workspaceCard).queryByRole("button", { name: "Edit message" }),
		).toBeNull();
		await user.click(
			within(workspaceCard).getByRole("button", { name: "Open target" }),
		);
		expect(useStore.getState().libraryView).toBe("photos");
	});
});
