import type { StructuredWorkspaceView } from "@maket/shared";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { READER_PANE_GUTTER, readingScale } from "./ReadingWorkspace";
import { StructuredCollectionWorkspace } from "./StructuredCollectionWorkspace";
import { WorkspaceHeader } from "./WorkspaceHeader";

const initial = useStore.getState();
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function documentFixture(
	name: string,
	role: "collection" | "item",
	pages = 1,
): Document {
	return {
		id: name,
		name,
		category: "Structured Workspaces/Simulation",
		canvas: {
			w: role === "collection" ? 80 : 210,
			h: 297,
			format: role === "collection" ? "AUTO" : "A4",
			background: "#fff",
		},
		activePage: 0,
		meta: {
			structuredWorkspace: {
				workspaceId: "simulation",
				collectionId: "subjects",
				role,
			},
		},
		pages: Array.from({ length: pages }, (_, i) => ({
			id: `${name}-${i}`,
			name: `${name} page ${i + 1}`,
			elements: [],
			html:
				i === 0
					? '<div data-id="body"><a data-id="next" href="#page=2">Read next page</a><textarea data-id="form" aria-label="Reader form"></textarea></div>'
					: '<p data-id="body">Detail</p>',
		})),
	};
}

function seed(includeItem = true) {
	const index = documentFixture("Index", "collection", 2);
	const item = documentFixture("First detail", "item", 3);
	const next = documentFixture("Next detail", "item", 2);
	const workspace: StructuredWorkspaceView = {
		id: "simulation",
		name: "Simulation",
		dataSchema: { type: "object" },
		revision: 1,
		representationSchema: { version: 1, collections: {} },
		integrity: { status: "ready", issues: [] },
		templateDocuments: [],
		collectionDocuments: [
			{
				collectionId: "subjects",
				documentId: index.id,
				documentName: index.name,
			},
		],
		itemCounts: { subjects: 2 },
		pinnedItems: [],
		createdAt: "2026-10-12",
		updatedAt: "2026-10-12",
	};
	useStore.setState({
		...initial,
		docs: new Map([index, item, next].map((doc) => [doc.name, doc])),
		workspaceDocNames: includeItem ? [index.name, item.name] : [index.name],
		focusedDocName: index.name,
		focusedPageIndex: 0,
		structuredWorkspaceLayout: "split",
		structuredWorkspaces: [workspace],
		activeStructuredWorkspaceId: workspace.id,
		collections: [],
		chartesCss: new Map(),
	});
	return { index, item, next };
}

beforeEach(() => {
	setLang("en");
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
	HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
	cleanup();
	HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
	vi.restoreAllMocks();
});

describe("StructuredCollectionWorkspace reader navigation", () => {
	it("switches layouts from the icon-only general toolbar and keeps annotations in the detail toolbar", async () => {
		seed();
		const user = userEvent.setup();
		const { container } = render(
			<>
				<WorkspaceHeader />
				<StructuredCollectionWorkspace />
			</>,
		);
		const toolbar = screen.getByRole("banner");
		const toggle = within(toolbar).getByRole("button", {
			name: "List and detail · Switch to Single document",
		});
		expect(toggle).toHaveAttribute("aria-pressed", "true");
		expect(toggle).toHaveTextContent("");
		expect(toggle.querySelector(".lucide-panel-left")).not.toBeNull();
		expect(screen.queryByRole("group", { name: "Collection view" })).toBeNull();
		expect(
			within(toolbar).queryByRole("button", { name: "Annotate" }),
		).toBeNull();
		const item = container.querySelector(
			"[data-structured-item-pane]",
		) as HTMLElement;
		const annotation = within(item).getByRole("button", { name: "Annotate" });
		expect(annotation.textContent).toBe("");
		await user.click(toggle);
		expect(container.querySelector("[data-layout]")).toHaveAttribute(
			"data-layout",
			"single",
		);
		const single = within(toolbar).getByRole("button", {
			name: "Single document · Switch to List and detail",
		});
		expect(single.querySelector(".lucide-square")).not.toBeNull();
		await user.click(single);
		expect(container.querySelector("[data-layout]")).toHaveAttribute(
			"data-layout",
			"split",
		);
		expect(
			within(toolbar).queryByRole("button", { name: "Reading view" }),
		).toBeNull();
	});
	it("opens both panes fitted in reading mode and leaves ordinary wheel input to scrolling", () => {
		const { index, item } = seed();
		localStorage.setItem(`maket.reader.zoom:${index.id}`, "1.8");
		localStorage.setItem(`maket.reader.zoom:${item.id}`, "1.7");
		const { container } = render(<StructuredCollectionWorkspace />);
		expect(container.querySelector("[data-layout]")).toHaveAttribute(
			"data-layout",
			"split",
		);
		expect(screen.getByRole("separator")).toHaveAttribute(
			"aria-valuenow",
			"28",
		);
		const panes = container.querySelectorAll("[data-collection-document-mode]");
		expect(panes).toHaveLength(2);
		const fits = [
			readingScale(900, 80, "fill"),
			readingScale(900, 210, "fill"),
		];
		for (const [i, pane] of [...panes].entries()) {
			expect(pane).toHaveAttribute("data-collection-document-mode", "reader");
			const root = pane.querySelector(
				"[data-reading-workspace]",
			) as HTMLElement;
			const content = pane.querySelector("[data-reader-zoom]") as HTMLElement;
			expect(root.style.paddingLeft).toBe(`${READER_PANE_GUTTER}px`);
			expect(root.style.paddingRight).toBe(`${READER_PANE_GUTTER}px`);
			expect(Number(content.style.zoom)).toBeCloseTo(fits[i] ?? 0);
			expect(fireEvent.wheel(root, { deltaY: 100, cancelable: true })).toBe(
				true,
			);
			expect(Number(content.style.zoom)).toBeCloseTo(fits[i] ?? 0);
		}
		expect(
			container.querySelector(
				'[data-structured-index-pane] [data-auto-height="true"]',
			),
		).not.toBeNull();
		expect(
			container.querySelectorAll(
				"[data-structured-item-pane] [data-page-view]",
			),
		).toHaveLength(3);
		expect(screen.queryByRole("group", { name: "Reader zoom" })).toBeNull();
	});

	it("refits each pane when the separator or the window resizes it and resets an explicit zoom to that fit", async () => {
		const observers: Array<() => void> = [];
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: () => void) {
					observers.push(callback);
				}
				observe() {}
				disconnect() {}
			},
		);
		let paneWidth = 400;
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
			function (this: HTMLElement) {
				return this.parentElement?.hasAttribute("data-structured-navigation")
					? 1000
					: paneWidth;
			},
		);
		seed();
		const user = userEvent.setup();
		render(<StructuredCollectionWorkspace />);
		const indexPane = document.querySelector(
			"[data-structured-index-pane]",
		) as HTMLElement;
		const content = indexPane.querySelector(
			"[data-reader-zoom]",
		) as HTMLElement;
		expect(Number(content.style.zoom)).toBeCloseTo(
			readingScale(400, 80, "fill"),
		);
		paneWidth = 640;
		act(() => {
			for (const refit of observers) refit();
		});
		const fit = readingScale(640, 80, "fill");
		expect(Number(content.style.zoom)).toBeCloseTo(fit);
		const fitButton = within(indexPane).getByRole("button", {
			name: `Fit to view — ${Math.round(fit * 100)}%`,
		});
		await user.click(
			within(indexPane).getByRole("button", { name: "Canvas view" }),
		);
		const root = indexPane.querySelector(
			"[data-reading-workspace]",
		) as HTMLElement;
		fireEvent.wheel(root, { deltaY: -100, cancelable: true });
		expect(Number(content.style.zoom)).toBeGreaterThan(fit);
		await user.click(fitButton);
		expect(Number(content.style.zoom)).toBeCloseTo(fit);
		vi.unstubAllGlobals();
	});

	it("keeps a page narrower than the single-document pane at its natural size", () => {
		seed();
		useStore.setState({ structuredWorkspaceLayout: "single" });
		const { container } = render(<StructuredCollectionWorkspace />);
		const content = container.querySelector(
			"[data-structured-index-pane] [data-reader-zoom]",
		) as HTMLElement;
		expect(content.style.zoom).toBe("1");
	});

	it("enables canvas navigation only in the selected pane and retains form scrolling", async () => {
		seed();
		const user = userEvent.setup();
		render(<StructuredCollectionWorkspace />);
		const itemPane = document.querySelector(
			"[data-structured-item-pane]",
		) as HTMLElement;
		const indexPane = document.querySelector(
			"[data-structured-index-pane]",
		) as HTMLElement;
		await user.click(
			within(itemPane).getByRole("button", { name: "Canvas view" }),
		);
		expect(
			itemPane.querySelector("[data-collection-document-mode]"),
		).toHaveAttribute("data-collection-document-mode", "canvas");
		expect(
			indexPane.querySelector("[data-collection-document-mode]"),
		).toHaveAttribute("data-collection-document-mode", "reader");
		const root = itemPane.querySelector(
			"[data-reading-workspace]",
		) as HTMLElement;
		const content = itemPane.querySelector("[data-reader-zoom]") as HTMLElement;
		expect(fireEvent.wheel(root, { deltaY: -100, cancelable: true })).toBe(
			false,
		);
		const zoom = content.style.zoom;
		expect(Number(zoom)).toBeGreaterThan(1);
		expect(
			fireEvent.wheel(within(itemPane).getByRole("textbox"), {
				deltaY: 100,
				cancelable: true,
			}),
		).toBe(true);
		expect(content.style.zoom).toBe(zoom);
		await user.click(
			within(itemPane).getByRole("button", { name: "Reading view" }),
		);
		expect(Number(content.style.zoom)).toBeCloseTo(
			readingScale(900, 210, "fill"),
		);
	});

	it("replaces one detail without remounting the index and follows links between detail pages", () => {
		const { index, next } = seed();
		render(<StructuredCollectionWorkspace />);
		const root = document.querySelector(
			"[data-structured-index-pane] [data-reading-workspace]",
		) as HTMLElement;
		root.scrollTop = 120;
		act(() => useStore.getState().upsertDoc(next, [], "", true, true, true));
		expect(useStore.getState().workspaceDocNames).toEqual([
			index.name,
			next.name,
		]);
		expect(
			document.querySelector(
				"[data-structured-index-pane] [data-reading-workspace]",
			),
		).toBe(root);
		expect(root.scrollTop).toBe(120);
		const itemPane = document.querySelector(
			"[data-structured-item-pane]",
		) as HTMLElement;
		expect(itemPane.querySelectorAll("[data-doc]")).toHaveLength(1);
		expect(itemPane.querySelectorAll("[data-page-view]")).toHaveLength(2);
		fireEvent.click(
			within(itemPane).getByRole("link", { name: "Read next page" }),
		);
		expect(useStore.getState().focusedPageIndex).toBe(1);
		expect(useStore.getState().selectedIds).toEqual([]);
	});

	it("keeps the narrow index and an empty detail pane before opening and after closing a detail", async () => {
		const { item } = seed(false);
		const user = userEvent.setup();
		render(<StructuredCollectionWorkspace />);
		expect(
			screen.getByText("Open an item from the index to read its details."),
		).toBeVisible();
		act(() => useStore.getState().upsertDoc(item, [], "", true, true, true));
		await user.click(
			screen.getByRole("button", {
				name: "Close First detail",
			}),
		);
		expect(
			screen.getByText("Open an item from the index to read its details."),
		).toBeVisible();
		expect(screen.getByRole("separator")).toBeVisible();
	});
});
