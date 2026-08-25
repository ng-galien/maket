import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import { enterReadingSession } from "../store/readingSession";
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

function WorkspaceViewHarness() {
	const workspaceView = useStore((state) => state.workspaceView);
	return workspaceView === "reading" ? (
		<ReadingWorkspace />
	) : (
		<div data-canvas-workspace />
	);
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

	it("uses directional arrows to move between reader pages", () => {
		const doc = makeDoc("report", 3);
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 0,
			workspaceView: "reading",
		});

		render(
			<>
				<ReadingWorkspace />
				<input aria-label="Reader test input" />
			</>,
		);

		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(useStore.getState().focusedPageIndex).toBe(1);
		fireEvent.keyDown(window, { key: "ArrowDown" });
		expect(useStore.getState().focusedPageIndex).toBe(2);
		fireEvent.keyDown(window, { key: "ArrowLeft" });
		expect(useStore.getState().focusedPageIndex).toBe(1);
		fireEvent.keyDown(window, { key: "ArrowUp" });
		expect(useStore.getState().focusedPageIndex).toBe(0);

		const input = screen.getByRole("textbox", { name: "Reader test input" });
		input.focus();
		fireEvent.keyDown(input, { key: "ArrowRight" });
		expect(useStore.getState().focusedPageIndex).toBe(0);
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

		render(<WorkspaceViewHarness />);
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

	it("closes with a plain close control and restores the originating workspace", async () => {
		const user = userEvent.setup();
		const alpha = makeDoc("alpha", 2);
		const beta = makeDoc("beta");
		useStore.setState({
			docs: new Map([
				[alpha.name, alpha],
				[beta.name, beta],
			]),
			workspaceDocNames: [alpha.name, beta.name],
			focusedDocName: alpha.name,
			focusedPageIndex: 1,
			focusedCollectionName: "clients",
			dataDockMode: "expanded",
			stateDockOpen: false,
			libraryOpen: true,
			libraryView: "collections",
			settingsOpen: false,
			selectedIds: ["element-1"],
			editingElementId: "element-1",
			showPopover: true,
			workspaceView: "canvas",
		});
		expect(enterReadingSession()).toBe(true);

		render(<WorkspaceViewHarness />);
		await user.click(screen.getByRole("button", { name: "Next document" }));
		expect(useStore.getState().focusedDocName).toBe(beta.name);
		const close = screen.getByRole("button", { name: "Close reader" });
		expect(close.querySelector(".lucide-x")).not.toBeNull();
		expect(
			screen.getByRole("navigation", { name: "Reader navigation" })
				.lastElementChild,
		).toBe(close);
		await user.click(close);
		expect(document.querySelector("[data-canvas-workspace]")).not.toBeNull();

		expect(useStore.getState()).toMatchObject({
			workspaceView: "canvas",
			focusedDocName: alpha.name,
			focusedPageIndex: 1,
			focusedCollectionName: "clients",
			dataDockMode: "expanded",
			stateDockOpen: false,
			libraryOpen: true,
			libraryView: "collections",
			settingsOpen: false,
			selectedIds: ["element-1"],
			editingElementId: "element-1",
			showPopover: true,
		});
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
		expect(workspace).toHaveClass("pt-16");
		expect(workspace).toHaveAttribute("data-bar-position", "top");
		expect(
			screen.getByRole("navigation", { name: "Reader navigation" }),
		).toHaveClass("h-12", "p-1", "rounded-lg");
		expect(screen.getByRole("button", { name: "Close reader" })).toHaveClass(
			"size-9",
			"rounded-md",
		);
	});
});
