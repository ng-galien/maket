import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsCategoryHeader } from "./DocsCategory";
import type { DocsCategoryModel } from "./types";

afterEach(cleanup);

describe("DocsCategoryHeader", () => {
	it("uses the whole category row to collapse or expand the tree", () => {
		const toggle = vi.fn();
		const model: DocsCategoryModel = {
			name: "roadmap",
			path: "roadmap",
			depth: 0,
			total: 1,
			docs: [],
			children: [],
			collapsed: false,
			dropActive: false,
			view: "list",
			toggle,
			dragOver: vi.fn(),
			dragLeave: vi.fn(),
			drop: vi.fn(),
			itemFor: vi.fn(() => {
				throw new Error("not used");
			}),
		};

		render(<DocsCategoryHeader model={model} />);
		fireEvent.click(screen.getByTitle("roadmap"));

		expect(toggle).toHaveBeenCalledOnce();
	});
});
