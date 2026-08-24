import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../../i18n/useT";
import { DocsCategoryHeader } from "./DocsCategory";
import type { DocsCategoryModel } from "./types";

beforeEach(() => setLang("en"));
afterEach(cleanup);

describe("DocsCategoryHeader", () => {
	it("uses the whole category row to collapse or expand the tree", () => {
		const toggle = vi.fn();
		const model = categoryModel({
			name: "roadmap",
			path: "roadmap",
			toggle,
		});

		render(<DocsCategoryHeader model={model} />);
		fireEvent.click(screen.getByTitle("roadmap"));

		expect(toggle).toHaveBeenCalledOnce();
	});

	it("keeps the category content anchored after its indentation", () => {
		const model = categoryModel({
			name: "Prototypes",
			path: "Produits/Workbench/Prototypes",
			depth: 2,
			total: 3,
			openTotal: 2,
		});

		render(<DocsCategoryHeader model={model} />);

		const row = screen.getByTitle(model.path);
		expect(row).toHaveClass("text-left");
		expect(row).toHaveStyle({ paddingLeft: "40px" });
		expect(row.querySelector("[data-category-content]")).toHaveClass(
			"w-fit",
			"max-w-full",
		);
		expect(row.querySelector("[data-category-label]")).toHaveTextContent(
			"Prototypes",
		);
	});

	it("offers the same explicit rename and move actions on categories", () => {
		const startMove = vi.fn();
		const startRename = vi.fn();
		const model = categoryModel({
			name: "Prototypes",
			path: "Produits/Workbench/Prototypes",
			menuOpen: true,
			startMove,
			startRename,
		});

		render(<DocsCategoryHeader model={model} />);
		const trigger = screen.getByRole("button", {
			name: "Actions for Produits/Workbench/Prototypes",
		});
		expect(trigger).toHaveAttribute("aria-haspopup", "menu");
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("menu")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
		expect(startRename).toHaveBeenCalledOnce();

		fireEvent.click(screen.getByRole("menuitem", { name: "Move…" }));
		expect(startMove).toHaveBeenCalledOnce();
	});

	it("keeps both document counts readable on an active drop target", () => {
		const model = categoryModel({
			openTotal: 2,
			dropActive: true,
			total: 5,
		});

		render(<DocsCategoryHeader model={model} />);

		expect(screen.getByTitle("5 documents, 2 open")).toHaveClass(
			"bg-accent",
			"text-accent-contrast",
		);
		expect(screen.getByText("2")).toHaveClass("text-accent-contrast");
	});
});

function categoryModel(
	overrides: Partial<DocsCategoryModel> = {},
): DocsCategoryModel {
	return {
		name: "roadmap",
		path: "roadmap",
		depth: 0,
		total: 1,
		openTotal: 0,
		docs: [],
		children: [],
		collapsed: false,
		dropActive: false,
		menuOpen: false,
		renaming: false,
		view: "list",
		toggle: vi.fn(),
		openMenu: vi.fn(),
		closeMenu: vi.fn(),
		startMove: vi.fn(),
		startRename: vi.fn(),
		cancelRename: vi.fn(),
		rename: vi.fn(),
		dragOver: vi.fn(),
		dragLeave: vi.fn(),
		drop: vi.fn(),
		itemFor: vi.fn(() => {
			throw new Error("not used");
		}),
		...overrides,
	};
}
