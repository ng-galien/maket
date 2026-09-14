import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../../i18n/useT";
import type { DocSummary } from "../../store/types";
import { DocRow } from "./DocItem";
import type { DocItemActions, DocItemModel } from "./types";

afterEach(() => {
	cleanup();
	setLang("en");
});

describe("DocRow", () => {
	it("keeps secondary details in a tooltip and exposes the useful row actions", () => {
		setLang("en");
		const doc: DocSummary = {
			id: "proposal-id",
			name: "Proposal",
			category: "clients/acme",
			dataModel: "state",
			format: "A4",
			pageCount: 3,
			elementCount: 12,
			collectionBindings: [],
			charte: "Acme",
			rating: 5,
			emailDraftUrl: "https://mail.google.com/mail/u/0/#drafts/example",
			emailDraftRole: "body",
		};
		const model: DocItemModel = {
			doc,
			onWs: true,
			focused: false,
			selected: false,
			menuOpen: false,
			mode: { kind: "idle" },
			canDelete: true,
			dragging: false,
		};
		const actions: DocItemActions = {
			click: vi.fn(),
			focus: vi.fn(),
			openMenu: vi.fn(),
			closeMenu: vi.fn(),
			changeMode: vi.fn(),
			moveCategory: vi.fn(),
			dragStart: vi.fn(),
			dragEnd: vi.fn(),
		};

		const { rerender } = render(<DocRow model={model} actions={actions} />);

		expect(screen.getByText("Proposal").parentElement).toHaveClass(
			"text-accent",
		);
		const tooltip = screen.getByRole("tooltip");
		expect(tooltip).toHaveTextContent(
			"A4 · 3p · State-backed document · Acme · ★ 5",
		);
		expect(tooltip).toHaveClass("doc-row-tooltip");
		expect(tooltip).not.toHaveClass("doc-row-tooltip--visible");
		const rowButton = screen.getByText("Proposal").closest("button");
		expect(rowButton).not.toBeNull();
		if (rowButton) {
			fireEvent.pointerEnter(rowButton, { clientX: 120, clientY: 80 });
			expect(tooltip).toHaveClass("doc-row-tooltip--visible");
			expect(tooltip).toHaveStyle({ left: "120px", top: "80px" });
			fireEvent.pointerDown(rowButton);
			expect(tooltip).not.toHaveClass("doc-row-tooltip--visible");
			const matches = rowButton.matches.bind(rowButton);
			vi.spyOn(rowButton, "matches").mockImplementation(
				(selector) => selector === ":focus-visible" || matches(selector),
			);
			fireEvent.focus(rowButton);
			expect(tooltip).toHaveClass("doc-row-tooltip--visible");
		}
		const draft = screen.getByRole("link", {
			name: "Open this email's draft in Gmail",
		});
		expect(draft).toHaveAttribute("href", doc.emailDraftUrl);

		const view = screen.getByRole("button", { name: "View Proposal" });
		expect(view).not.toHaveAttribute("aria-pressed");
		fireEvent.click(view);
		expect(actions.focus).toHaveBeenCalledOnce();
		expect(actions.click).not.toHaveBeenCalled();

		rerender(
			<DocRow
				model={{ ...model, mode: { kind: "rename" } }}
				actions={actions}
			/>,
		);
		const editor = screen.getByPlaceholderText(/^New name/);
		const editorMatches = editor.matches.bind(editor);
		vi.spyOn(editor, "matches").mockImplementation(
			(selector) => selector === ":focus-visible" || editorMatches(selector),
		);
		fireEvent.focus(editor);
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

		rerender(<DocRow model={model} actions={actions} />);
		expect(screen.getByRole("tooltip")).not.toHaveClass(
			"doc-row-tooltip--visible",
		);
	});

	it("keeps the Copy name label and copies the complete category path", async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const doc: DocSummary = {
			id: "proposal-id",
			name: "Proposal",
			category: "clients/acme/proposals",
			dataModel: "static",
			format: "A4",
			pageCount: 1,
			elementCount: 0,
			collectionBindings: [],
		};
		const actions: DocItemActions = {
			click: vi.fn(),
			focus: vi.fn(),
			openMenu: vi.fn(),
			closeMenu: vi.fn(),
			changeMode: vi.fn(),
			moveCategory: vi.fn(),
			dragStart: vi.fn(),
			dragEnd: vi.fn(),
		};

		render(
			<DocRow
				model={{
					doc,
					onWs: false,
					focused: false,
					selected: false,
					menuOpen: true,
					mode: { kind: "idle" },
					canDelete: true,
					dragging: false,
				}}
				actions={actions}
			/>,
		);

		fireEvent.click(screen.getByRole("menuitem", { name: "Copy name" }));

		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith("clients/acme/proposals/Proposal"),
		);
		expect(actions.closeMenu).toHaveBeenCalledOnce();
	});
});
