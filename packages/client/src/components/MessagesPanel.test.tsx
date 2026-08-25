import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

afterEach(cleanup);

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
		expect(screen.getAllByRole("button", { name: "Delete note" })).toHaveLength(
			2,
		);
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
});
