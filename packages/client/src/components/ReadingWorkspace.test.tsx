import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import {
	ReadingWorkspace,
	readingScale,
	readingShortcutBlocked,
} from "./ReadingWorkspace";

function makeDoc(name: string, pageCount = 1): Document {
	return {
		id: `id-${name}`,
		name,
		category: "reports",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: Array.from({ length: pageCount }, (_, index) => ({
			id: `${name}-page-${index + 1}`,
			name: `Page ${index + 1}`,
			elements: [],
		})),
		activePage: 0,
	};
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("ReadingWorkspace", () => {
	it("fits a fixed-width page inside narrow viewports without enlarging it", () => {
		expect(readingScale(320, 210)).toBeCloseTo(296 / (210 * (96 / 25.4)));
		expect(readingScale(1440, 210)).toBe(1);
	});

	it("blocks global reading shortcuts while a field or popover owns focus", () => {
		const input = document.createElement("input");
		expect(readingShortcutBlocked(input, null, false)).toBe(true);
		expect(readingShortcutBlocked(document.body, "title", false)).toBe(true);
		expect(readingShortcutBlocked(document.body, null, true)).toBe(true);
		expect(readingShortcutBlocked(document.body, null, false)).toBe(false);
	});

	it("renders only the focused document and hides the canvas document chip", () => {
		const alpha = makeDoc("alpha");
		const beta = makeDoc("beta");
		useStore.setState({
			docs: new Map([
				[alpha.name, alpha],
				[beta.name, beta],
			]),
			workspaceDocNames: [alpha.name, beta.name],
			focusedDocName: beta.name,
			focusedPageIndex: 0,
			workspaceView: "reading",
		});

		const { container } = render(<ReadingWorkspace />);
		expect(container.querySelectorAll("[data-doc]")).toHaveLength(1);
		expect(container.querySelector("[data-doc='beta']")).not.toBeNull();
		expect(container.querySelector(".doc-label")).toBeNull();
	});

	it("positions the focused page after StrictMode effect replay", () => {
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			nextFrame += 1;
			frames.set(nextFrame, callback);
			return nextFrame;
		});
		vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
			frames.delete(frame);
		});
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
		const scrolled: HTMLElement[] = [];
		HTMLElement.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
			scrolled.push(this);
		});
		const doc = makeDoc("report", 3);
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 2,
			workspaceView: "reading",
		});

		try {
			render(
				<StrictMode>
					<ReadingWorkspace />
				</StrictMode>,
			);
			expect(frames).toHaveLength(1);
			act(() => {
				for (const callback of frames.values()) callback(0);
				frames.clear();
			});
			expect(scrolled).toHaveLength(1);
			expect(scrolled[0]?.dataset.pageView).toBe("2");
		} finally {
			HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
		}
	});

	it("reserves toolbar clearance on the toolbar side", () => {
		const doc = makeDoc("report");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			workspaceView: "reading",
			barPosition: "bottom",
		});
		const { container } = render(<ReadingWorkspace />);
		const workspace = container.querySelector("[data-reading-workspace]");
		expect(workspace).toHaveClass("pb-20");
		expect(workspace).toHaveAttribute("data-bar-position", "bottom");

		act(() => useStore.getState().setBarPosition("top"));
		expect(workspace).toHaveClass("pt-20");
		expect(workspace).toHaveAttribute("data-bar-position", "top");
	});
});
