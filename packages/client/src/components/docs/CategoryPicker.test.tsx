import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../../i18n/useT";
import { CategoryPicker } from "./CategoryPicker";
import type { CategoryPickerModel } from "./types";

beforeEach(() => setLang("en"));
afterEach(cleanup);

describe("CategoryPicker", () => {
	it("consumes Escape before the library navigation can close", () => {
		const close = vi.fn();
		const shellEscape = vi.fn();
		document.addEventListener("keydown", shellEscape);
		render(
			<CategoryPicker
				model={{
					target: {
						kind: "document",
						name: "Proposal",
						category: "Clients/Current",
					},
					categories: ["Clients/Archive"],
					close,
					moveTo: vi.fn(),
				}}
			/>,
		);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(close).toHaveBeenCalledOnce();
		expect(shellEscape).not.toHaveBeenCalled();
		document.removeEventListener("keydown", shellEscape);
	});

	it("filters a large category list and moves a document to an existing path", () => {
		const moveTo = vi.fn();
		const model: CategoryPickerModel = {
			target: {
				kind: "document",
				name: "Proposal",
				category: "Clients/Current",
			},
			categories: [
				"Blog/Interne",
				"Clients/Current",
				"Clients/Archive",
				"Produits/Workbench/Prototypes",
			],
			close: vi.fn(),
			moveTo,
		};

		render(<CategoryPicker model={model} />);
		const input = screen.getByRole("combobox", {
			name: "Search or create a category…",
		});
		fireEvent.change(input, { target: { value: "archive" } });
		fireEvent.click(screen.getByRole("option", { name: "Clients/Archive" }));
		expect(moveTo).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Move to Clients/Archive" }),
		);

		expect(moveTo).toHaveBeenCalledWith("Clients/Archive");
		expect(screen.getByText("Archive")).toBeInTheDocument();
		expect(screen.queryByText("Clients/Archive")).not.toBeInTheDocument();
		expect(screen.queryByText("Blog/Interne")).not.toBeInTheDocument();
	});

	it("creates the typed category when no existing path matches", () => {
		const moveTo = vi.fn();
		const model: CategoryPickerModel = {
			target: {
				kind: "document",
				name: "Proposal",
				category: "Clients/Current",
			},
			categories: ["Clients/Current", "Clients/Archive"],
			close: vi.fn(),
			moveTo,
		};

		render(<CategoryPicker model={model} />);
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "Clients/New accounts" },
		});
		fireEvent.click(
			screen.getByRole("option", { name: "Clients/New accounts" }),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Move to Clients/New accounts" }),
		);

		expect(moveTo).toHaveBeenCalledWith("Clients/New accounts");
	});

	it("moves a category under a parent without proposing its own subtree", () => {
		const moveTo = vi.fn();
		const model: CategoryPickerModel = {
			target: { kind: "category", path: "Products/Workbench" },
			categories: [
				"Products",
				"Products/Workbench",
				"Products/Workbench/Prototypes",
				"Archive",
			],
			close: vi.fn(),
			moveTo,
		};

		render(<CategoryPicker model={model} />);
		expect(screen.queryByText("Products/Workbench")).not.toBeInTheDocument();
		expect(
			screen.queryByText("Products/Workbench/Prototypes"),
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("option", { name: "Archive" }));
		expect(moveTo).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Move to Archive/Workbench" }),
		);

		expect(moveTo).toHaveBeenCalledWith("Archive");
	});

	it("always shows the root destination and disables it only when already current", () => {
		const moveTo = vi.fn();
		const { rerender } = render(
			<CategoryPicker
				model={{
					target: {
						kind: "asset",
						name: "landscape.jpg",
						category: "Nature",
					},
					categories: ["Nature", "Archive"],
					close: vi.fn(),
					moveTo,
				}}
			/>,
		);

		expect(screen.getByRole("option", { name: "Root" })).toBeEnabled();
		fireEvent.click(screen.getByRole("option", { name: "Root" }));
		fireEvent.click(screen.getByRole("button", { name: "Move to Root" }));
		expect(moveTo).toHaveBeenCalledWith("");

		rerender(
			<CategoryPicker
				model={{
					target: {
						kind: "document",
						name: "Loose document",
						category: "general",
					},
					categories: ["Nature", "Archive"],
					close: vi.fn(),
					moveTo: vi.fn(),
				}}
			/>,
		);

		expect(screen.getByRole("option", { name: "Root" })).toBeDisabled();
	});

	it("traps focus and returns it to the opener after Escape", async () => {
		const user = userEvent.setup();
		render(<PickerHarness />);
		const opener = screen.getByRole("button", { name: "Move document" });

		await user.click(opener);
		await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());

		const close = screen.getByRole("button", { name: "Close" });
		close.focus();
		await user.tab({ shift: true });
		expect(screen.getByRole("option", { name: "Archive" })).toHaveFocus();

		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(opener).toHaveFocus();
	});
});

function PickerHarness() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Move document
			</button>
			<CategoryPicker
				model={{
					target: open
						? {
								kind: "document",
								name: "Proposal",
								category: "Clients/Current",
							}
						: null,
					categories: ["Archive"],
					close: () => setOpen(false),
					moveTo: vi.fn(),
				}}
			/>
		</>
	);
}
