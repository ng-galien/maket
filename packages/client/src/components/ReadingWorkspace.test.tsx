import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
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

beforeEach(() => setLang("en"));

describe("ReadingWorkspace", () => {
	it("fits a fixed-width page inside narrow viewports without enlarging it", () => {
		expect(readingScale(320, 210)).toBeCloseTo(296 / (210 * (96 / 25.4)));
		expect(readingScale(1440, 210)).toBe(1);
	});

	it("blocks global reading shortcuts while an interactive control owns focus", () => {
		const input = document.createElement("input");
		expect(readingShortcutBlocked(input)).toBe(true);
		expect(readingShortcutBlocked(document.body)).toBe(false);
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

	it("navigates between workspace documents without exposing author controls", async () => {
		const user = userEvent.setup();
		const alpha = makeDoc("alpha");
		const beta = makeDoc("beta");
		useStore.setState({
			docs: new Map([
				[alpha.name, alpha],
				[beta.name, beta],
			]),
			workspaceDocNames: [alpha.name, beta.name],
			focusedDocName: alpha.name,
			focusedPageIndex: 0,
			workspaceView: "reading",
		});

		render(<ReadingWorkspace />);
		expect(document.querySelector("[data-toolbar-shell]")).toBeNull();
		expect(document.querySelector(".element-toolbar")).toBeNull();

		await user.click(
			document.querySelector(
				'button[aria-label="Next document"]',
			) as HTMLButtonElement,
		);
		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(document.querySelector("[data-doc='beta']")).not.toBeNull();
	});

	it("keeps the document picker keyboard-accessible", async () => {
		const user = userEvent.setup();
		const alpha = makeDoc("alpha");
		const beta = makeDoc("beta");
		useStore.setState({
			docs: new Map([
				[alpha.name, alpha],
				[beta.name, beta],
			]),
			workspaceDocNames: [alpha.name, beta.name],
			focusedDocName: alpha.name,
			focusedPageIndex: 0,
			workspaceView: "reading",
		});

		render(<ReadingWorkspace />);
		const picker = document.querySelector(
			'button[aria-label="Document"]',
		) as HTMLButtonElement;
		await user.click(picker);
		expect(document.querySelector('[role="listbox"]')).not.toBeNull();
		await user.keyboard("b");
		expect(document.activeElement).toHaveTextContent("beta");
		await user.keyboard("{Enter}");
		expect(useStore.getState().focusedDocName).toBe("beta");

		await user.click(
			document.querySelector(
				'button[aria-label="Document"]',
			) as HTMLButtonElement,
		);
		await user.keyboard("{Tab}");
		expect(document.querySelector('[role="listbox"]')).toBeNull();
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

	it("reserves clearance for the stable top reading controls", () => {
		const doc = makeDoc("report");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			workspaceView: "reading",
		});
		const { container } = render(<ReadingWorkspace />);
		const workspace = container.querySelector("[data-reading-workspace]");
		expect(workspace).toHaveClass("pt-20");
		expect(workspace).toHaveAttribute("data-bar-position", "top");
	});
});
