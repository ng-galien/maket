import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { Popover } from "./Popover";

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "test",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-page`, name: "Page 1", elements: [] }],
		activePage: 0,
	};
}

beforeEach(() => {
	setLang("en");
	const doc = makeDoc("focused");
	useStore.setState({
		docs: new Map([[doc.name, doc]]),
		focusedDocName: doc.name,
		focusedPageIndex: 0,
		selectedIds: ["shared-element"],
		showPopover: true,
		editingElementId: null,
		pending: [],
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("Popover", () => {
	it("anchors to the selected element in the focused document", async () => {
		let notifyResize = () => {};
		const observed = new Set<Element>();
		let libraryWidth = 382;
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: ResizeObserverCallback) {
					notifyResize = () => callback([], this as unknown as ResizeObserver);
				}
				observe(element: Element) {
					observed.add(element);
				}
				unobserve() {}
				disconnect() {}
			},
		);
		const originalRect = HTMLElement.prototype.getBoundingClientRect;
		HTMLElement.prototype.getBoundingClientRect = function () {
			const library = this.hasAttribute("data-library-panel");
			const focused = this.closest('[data-doc="focused"]') !== null;
			const page = this.classList.contains("page-canvas");
			const selected = this.classList.contains("selected");
			const left = library
				? 0
				: focused
					? page
						? 0
						: selected
							? 447
							: 100
					: 20;
			const top = selected ? 700 : 200;
			const width = library
				? libraryWidth
				: focused
					? page
						? 1024
						: selected
							? 500
							: 100
					: 100;
			return {
				x: left,
				y: top,
				left,
				top,
				right: left + width,
				bottom: top + 40,
				width,
				height: 40,
				toJSON: () => ({}),
			} as DOMRect;
		};

		try {
			render(
				<>
					<aside data-library-panel data-library-mode="extended" />
					<div data-doc="other">
						<div className="page-canvas" data-page="0">
							<div data-id="shared-element">Wrong copy</div>
						</div>
					</div>
					<div data-doc="focused">
						<div className="page-canvas" data-page="0">
							<div data-id="shared-element">Wrong focused copy</div>
						</div>
						<div className="page-canvas" data-page="0">
							<div
								className="selected"
								data-id="shared-element"
								data-name="Selected label"
							>
								Focused copy
							</div>
						</div>
					</div>
					<Popover />
				</>,
			);

			const dialog = screen.getByRole("dialog", { name: "Comment" });
			const library = document.querySelector("[data-library-panel]");
			expect(library && observed.has(library)).toBe(true);
			expect(dialog).toHaveStyle({ left: "667px", top: "532px" });
			Object.defineProperty(dialog, "offsetHeight", {
				configurable: true,
				value: 300,
			});
			act(() => notifyResize());
			expect(dialog).toHaveStyle({ left: "667px", top: "452px" });
			libraryWidth = 720;
			act(() => notifyResize());
			expect(dialog).toHaveStyle({ left: "720px", top: "452px" });
			expect(screen.getByText("Selected label")).toBeInTheDocument();
			const note = screen.getByPlaceholderText("Note for the agent...");
			const send = screen.getByRole("button", { name: "Send note" });
			expect(send).toBeDisabled();
			await userEvent.type(note, "Tighten the label spacing");
			expect(send).toBeEnabled();
		} finally {
			HTMLElement.prototype.getBoundingClientRect = originalRect;
		}
	});
});
