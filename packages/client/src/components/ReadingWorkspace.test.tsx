import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	onTestFinished,
	vi,
} from "vitest";
import { setLang } from "../i18n/useT";
import { enterReadingSession } from "../store/readingSession";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import {
	READER_PANE_GUTTER,
	ReaderSurface,
	ReadingWorkspace,
	readerGutter,
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
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

beforeEach(() => setLang("en"));

describe("ReadingWorkspace", () => {
	it("fits a fixed-width page inside narrow viewports without enlarging it", () => {
		expect(readingScale(320, 210)).toBeCloseTo(296 / (210 * (96 / 25.4)));
		expect(readingScale(1440, 210)).toBe(1);
	});

	it("fills a list-and-detail pane width at fit, enlarging or reducing, inside the pane gutter", () => {
		const pagePx = (mm: number) => mm * (96 / 25.4);
		expect(READER_PANE_GUTTER).toBe(8);
		expect(readerGutter(400, "fill")).toBe(READER_PANE_GUTTER);
		expect(readerGutter(1200, "fill")).toBe(READER_PANE_GUTTER);
		const narrow = readingScale(1000, 80, "fill");
		expect(narrow).toBeGreaterThan(1);
		expect(pagePx(80) * narrow).toBeCloseTo(1000 - 2 * READER_PANE_GUTTER);
		const wide = readingScale(380, 210, "fill");
		expect(wide).toBeLessThan(1);
		expect(pagePx(210) * wide).toBeCloseTo(380 - 2 * READER_PANE_GUTTER);
	});

	it("fits the single-document reader to a window narrower than the page and keeps the natural size otherwise", () => {
		expect(readerGutter(320, "shrink")).toBe(12);
		expect(readerGutter(700, "shrink")).toBe(24);
		const scale = readingScale(700, 210, "shrink");
		expect(210 * (96 / 25.4) * scale).toBeCloseTo(700 - 48);
		expect(readingScale(1440, 80, "shrink")).toBe(1);
	});

	it("zooms the reading surface through controls, shortcuts, and modified wheel input", async () => {
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
		const user = userEvent.setup();
		const doc = makeDoc("report");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			workspaceView: "reading",
		});

		const { container } = render(<ReadingWorkspace />);
		const workspace = container.querySelector(
			"[data-reading-workspace]",
		) as HTMLElement;
		const zoomed = container.querySelector("[data-reader-zoom]") as HTMLElement;

		expect(zoomed.style.zoom).toBe("1");
		await user.click(screen.getByRole("button", { name: "Zoom in" }));
		expect(Number.parseFloat(zoomed.style.zoom)).toBeCloseTo(1.1);
		const pinched = 1.1 * Math.exp(0.1);
		fireEvent.wheel(workspace, { ctrlKey: true, deltaY: -10 });
		expect(Number.parseFloat(zoomed.style.zoom)).toBeCloseTo(pinched);
		fireEvent.wheel(workspace, { deltaY: -10 });
		expect(Number.parseFloat(zoomed.style.zoom)).toBeCloseTo(pinched);
		fireEvent.keyDown(window, { key: "-" });
		expect(Number.parseFloat(zoomed.style.zoom)).toBeCloseTo(pinched - 0.1);
		expect(localStorage.getItem("maket.reader.zoom:id-report")).toBe(
			String(Math.round((pinched - 0.1) * 1000) / 1000),
		);
		await user.click(
			screen.getByRole("button", {
				name: `Fit to view — ${Math.round((pinched - 0.1) * 100)}%`,
			}),
		);
		expect(zoomed.style.zoom).toBe("1");
		expect(localStorage.getItem("maket.reader.zoom:id-report")).toBeNull();
		expect(useStore.getState().zoom).toBe(100);
	});

	it("uses ordinary wheel zoom in a workspace canvas while retaining native form scrolling", () => {
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
		const doc = makeDoc("canvas-wheel");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
		});
		const { container } = render(
			<ReaderSurface
				doc={doc}
				dataSource="connected"
				canvasNavigation
				onNavigatePage={() => {}}
				status={
					<form>
						<textarea aria-label="Instructions" />
					</form>
				}
			/>,
		);
		const root = container.querySelector(
			"[data-reading-workspace]",
		) as HTMLElement;
		const content = container.querySelector(
			"[data-reader-zoom]",
		) as HTMLElement;
		expect(fireEvent.wheel(root, { deltaY: -100, cancelable: true })).toBe(
			false,
		);
		const zoom = content.style.zoom;
		expect(Number(zoom)).toBeGreaterThan(1);
		expect(
			fireEvent.wheel(screen.getByRole("textbox", { name: "Instructions" }), {
				deltaY: -100,
				cancelable: true,
			}),
		).toBe(true);
		expect(content.style.zoom).toBe(zoom);
		expect(screen.queryByRole("group", { name: "Reader zoom" })).toBeNull();
	});

	it("accumulates wheel events before a render without moving their document anchor", () => {
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
		const doc = makeDoc("rapid-canvas-wheel");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
		});
		const { container } = render(
			<ReaderSurface
				doc={doc}
				dataSource="connected"
				canvasNavigation
				onNavigatePage={() => {}}
			/>,
		);
		const root = container.querySelector(
			"[data-reading-workspace]",
		) as HTMLElement;
		const content = container.querySelector(
			"[data-reader-zoom]",
		) as HTMLElement;
		act(() => {
			for (let i = 0; i < 2; i++)
				root.dispatchEvent(
					new WheelEvent("wheel", {
						bubbles: true,
						cancelable: true,
						deltaY: -100,
						clientX: 200,
						clientY: 200,
					}),
				);
		});
		const scale = Number(content.style.zoom);
		expect(scale).toBeCloseTo(Math.exp(0.4));
		expect(root.scrollLeft).toBeCloseTo(200 * (scale - 1));
		expect(root.scrollTop).toBeCloseTo(200 * (scale - 1));
	});

	it("starts at the responsive reading fit and allows horizontal overflow after zooming", () => {
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
		const doc = makeDoc("report");
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			workspaceView: "reading",
		});

		const { container } = render(<ReadingWorkspace />);
		const workspace = container.querySelector("[data-reading-workspace]");
		const zoomed = container.querySelector<HTMLElement>("[data-reader-zoom]");
		expect(Number.parseFloat(zoomed?.style.zoom ?? "0")).toBeCloseTo(
			readingScale(320, 210),
		);
		expect(workspace).toHaveClass("overflow-auto");
		expect(screen.getByRole("group", { name: "Reader zoom" })).toBeVisible();
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

	it("keeps the Reader surface and its page when the open document is renamed", () => {
		const doc = makeDoc("draft", 2);
		useStore.setState({
			docs: new Map([[doc.name, doc]]),
			workspaceDocNames: [doc.name],
			focusedDocName: doc.name,
			focusedPageIndex: 1,
			workspaceView: "reading",
		});
		const { container } = render(<ReadingWorkspace />);
		const surface = container.querySelector("[data-reading-workspace]");
		expect(screen.getByRole("status")).toHaveTextContent("2/2");

		act(() => {
			useStore
				.getState()
				.replaceRenamedDoc("draft", { ...doc, name: "final" }, [], "");
		});

		expect(container.querySelector("[data-doc='final']")).not.toBeNull();
		expect(container.querySelector("[data-reading-workspace]")).toBe(surface);
		expect(useStore.getState().focusedPageIndex).toBe(1);
		expect(screen.getByRole("status")).toHaveTextContent("2/2");
	});

	it.each([1, 3])(
		"shows page titles only for a multi-page Reader document (%i pages)",
		(count) => {
			const doc = makeDoc("report", count);
			doc.pages[0].name = "Overview";
			useStore.setState({
				docs: new Map([[doc.name, doc]]),
				workspaceDocNames: [doc.name],
				focusedDocName: doc.name,
				focusedPageIndex: 0,
				workspaceView: "reading",
			});
			const { container } = render(<ReadingWorkspace />);
			const titles = container.querySelectorAll("[data-reader-page-title]");
			expect(titles).toHaveLength(count > 1 ? count : 0);
			if (count > 1)
				expect([...titles].map((title) => title.textContent)).toEqual([
					"Overview",
					"Page 2",
					"Page 3",
				]);
		},
	);

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
			messageAnchor: { docName: "alpha", pageIndex: 1, elementId: "element-1" },
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
			messageAnchor: { docName: "alpha", pageIndex: 1, elementId: "element-1" },
		});
	});

	it("lists pinned documents as a first group in the Reader navigation and opens them", async () => {
		const user = userEvent.setup();
		const alpha = makeDoc("alpha");
		const beta = makeDoc("beta");
		const summary = (name: string, pinnedAt?: string) => ({
			id: `id-${name}`,
			name,
			category: "reports",
			format: "A4",
			pageCount: 1,
			elementCount: 0,
			collectionBindings: [],
			...(pinnedAt ? { pinnedAt } : {}),
		});
		const openWorkspaceDocument = vi.fn();
		const original = useStore.getState();
		onTestFinished(() =>
			useStore.setState({
				docList: original.docList,
				openWorkspaceDocument: original.openWorkspaceDocument,
			}),
		);
		useStore.setState({
			docs: new Map([
				[alpha.name, alpha],
				[beta.name, beta],
			]),
			docList: [
				summary("alpha"),
				summary("beta", "2026-10-10T08:00:00.000Z"),
				summary("dossier", "2026-10-10T09:00:00.000Z"),
				summary("archive"),
			],
			workspaceDocNames: [alpha.name, beta.name],
			focusedDocName: alpha.name,
			focusedPageIndex: 0,
			workspaceView: "reading",
			openWorkspaceDocument,
		});

		render(<ReadingWorkspace />);
		await user.click(screen.getByRole("button", { name: "Document" }));

		const listbox = screen.getByRole("listbox", { name: "Document" });
		const groups = within(listbox).getAllByRole("group");
		expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
			"Pinned",
			"Open documents",
		]);
		expect(
			within(groups[0] as HTMLElement)
				.getAllByRole("option")
				.map((option) => option.getAttribute("aria-label")),
		).toEqual(["dossier", "beta"]);
		expect(
			within(groups[1] as HTMLElement)
				.getAllByRole("option")
				.map((option) => option.getAttribute("aria-label")),
		).toEqual(["alpha"]);

		await user.keyboard("{Home}{Enter}");
		expect(openWorkspaceDocument).toHaveBeenCalledWith("dossier");
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
