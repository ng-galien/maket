import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { PhotosTab } from "./PhotosTab";

const wsMocks = vi.hoisted(() => ({ wsSend: vi.fn(() => true) }));
vi.mock("../store/ws", () => wsMocks);

const originalAddPending = useStore.getState().addPending;

beforeEach(() => {
	setLang("en");
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			json: async () => ({ images: [{ file: "sample.png" }] }),
		}),
	);
	useStore.setState({
		assets: [],
		assetsLoaded: false,
		assetsLoading: false,
		docs: new Map(),
		workspaceDocNames: ["missing-document"],
		focusedDocName: "missing-document",
		addPending: vi.fn(),
	});
	wsMocks.wsSend.mockClear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	useStore.setState({ addPending: originalAddPending });
});

describe("PhotosTab insertion availability", () => {
	it("uses the shared transient library scrollbar", async () => {
		render(<PhotosTab />);

		await screen.findByRole("button", { name: "Actions" });
		const scrollArea = document.querySelector<HTMLElement>(
			"[data-photos-scroll]",
		);
		expect(scrollArea).not.toBeNull();
		expect(scrollArea).toHaveClass("library-scroll-area");

		fireEvent.scroll(scrollArea as HTMLElement);
		expect(scrollArea).toHaveAttribute("data-scrolling", "true");
	});

	it("disables insertion when the focused document is not loaded", async () => {
		const user = userEvent.setup();
		render(<PhotosTab />);

		await user.click(await screen.findByRole("button", { name: "Actions" }));
		const menuInsert = await screen.findByRole("menuitem", {
			name: "Ask the agent to add this image",
		});
		expect(menuInsert).toBeDisabled();
		expect(
			screen.getByRole("menuitem", { name: "Copy filename" }),
		).toHaveFocus();
		expect(menuInsert).toHaveAttribute(
			"title",
			"Open a document before asking the agent to add this image",
		);

		await user.click(menuInsert);
		expect(useStore.getState().addPending).not.toHaveBeenCalled();

		await user.keyboard("{Escape}");
		await user.click(
			screen.getByRole("button", { name: "sample.png sample.png" }),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", {
					name: "Ask the agent to add this image",
				}),
			).toBeDisabled(),
		);
	});

	it("supports filtering, selection, menus, detail actions, and thumbnail fallback", async () => {
		const user = userEvent.setup();
		const document = makeDoc("poster");
		const addPending = vi.fn(async () => ({ ok: true as const }));
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				json: async () => ({
					images: [
						{
							file: "forest.png",
							title: "Forest",
							description: "Green trees",
							category: "Nature",
							tags: ["green", "trees"],
							width: 1200,
							height: 800,
						},
						{ file: "sea.png", title: "Sea", category: "Nature" },
						{ file: "office.png", title: "Office", category: "Work" },
					],
				}),
			}),
		);
		useStore.setState({
			docs: new Map([[document.name, document]]),
			workspaceDocNames: [document.name],
			focusedDocName: document.name,
			addPending,
		});
		render(<PhotosTab />);

		const forestTile = await screen.findByRole("button", { name: /^Forest/ });
		expect(forestTile).toHaveClass("hover:ring-2", "hover:ring-accent/30");
		const forestDimensions = screen.getByText("1200×800");
		expect(forestDimensions).toHaveClass("top-1.5", "left-1.5");
		expect(forestDimensions).not.toHaveClass("bottom-1.5");
		fireEvent.error(screen.getByRole("img", { name: "Forest" }));
		expect(screen.getByRole("img", { name: "Forest" })).toHaveAttribute(
			"src",
			"/assets/forest.png",
		);
		const fullscreenTrigger = screen.getAllByRole("button", {
			name: "View image full screen",
		})[0] as HTMLElement;
		await user.click(fullscreenTrigger);
		expect(screen.getByRole("dialog", { name: "Forest" })).toBeVisible();
		const closeFullscreen = screen.getByRole("button", {
			name: "Close full screen",
		});
		await waitFor(() => expect(closeFullscreen).toHaveFocus());
		await user.tab();
		expect(closeFullscreen).toHaveFocus();
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog", { name: "Forest" })).toBeNull();
		expect(fullscreenTrigger).toHaveFocus();

		const search = screen.getByRole("textbox", {
			name: "Search images or @category…",
		});
		await user.type(search, "@Work");
		expect(screen.getByRole("button", { name: "Office Office" })).toBeVisible();
		expect(screen.queryByRole("button", { name: /^Forest/ })).toBeNull();
		await user.click(screen.getByRole("button", { name: "Clear search" }));
		const workCategory = screen.getByRole("button", {
			name: "Show or hide category Work",
		});
		expect(workCategory).toHaveAttribute("aria-expanded", "true");
		await user.click(workCategory);
		expect(screen.queryByRole("button", { name: "Office Office" })).toBeNull();
		await user.click(workCategory);
		expect(screen.getByRole("button", { name: "Office Office" })).toBeVisible();
		await user.click(
			screen.getByRole("button", { name: "Actions for Nature" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Move…" }));
		expect(screen.getByRole("dialog", { name: "Move “Nature”" })).toBeVisible();
		await user.click(screen.getByRole("option", { name: "Work" }));
		await user.click(
			screen.getByRole("button", { name: "Move to Work/Nature" }),
		);
		expect(wsMocks.wsSend).toHaveBeenCalledWith({
			type: "move_asset_category",
			source: "Nature",
			destination: "Work/Nature",
		});
		const grid = screen.getByRole("button", { name: /^Forest/ }).parentElement
			?.parentElement as HTMLElement;
		fireEvent.dragOver(grid, { dataTransfer: { files: [], types: ["Files"] } });
		fireEvent.dragLeave(grid);
		fireEvent.drop(grid, { dataTransfer: { files: [], types: ["Files"] } });

		fireEvent.click(screen.getByRole("button", { name: /^Forest/ }), {
			ctrlKey: true,
		});
		fireEvent.click(screen.getByRole("button", { name: "Sea Sea" }), {
			shiftKey: true,
		});
		expect(screen.getByText("2 selected")).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Delete" }));
		await user.click(screen.getByRole("button", { name: "Confirm delete" }));
		expect(wsMocks.wsSend).toHaveBeenCalledWith({
			type: "delete_asset",
			filename: "forest.png",
		});

		await user.click(
			screen.getAllByRole("button", { name: "Actions" })[0] as HTMLElement,
		);
		await user.click(
			await screen.findByRole("menuitem", { name: "Copy filename" }),
		);
		await user.click(
			screen.getAllByRole("button", { name: "Actions" })[0] as HTMLElement,
		);
		await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
		await user.click(
			screen.getByRole("button", { name: /^(Cancel|Annuler)$/ }),
		);
		await user.click(screen.getByRole("button", { name: /^Forest/ }));
		expect(screen.getByText("Green trees")).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Delete" }));
		await user.keyboard("{Escape}");
		expect(
			screen.getByRole("button", {
				name: "Ask the agent to add this image",
			}),
		).toBeVisible();
		await user.click(
			screen.getByRole("button", { name: "View image full screen" }),
		);
		expect(screen.getByRole("dialog", { name: "Forest" })).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Close full screen" }));
		await user.click(
			screen.getByRole("button", {
				name: "Ask the agent to add this image",
			}),
		);
		await waitFor(() =>
			expect(addPending).toHaveBeenCalledWith(
				expect.objectContaining({ type: "drop-image", file: "forest.png" }),
			),
		);
	});

	it("moves an image to another category by drag and drop", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				images: [
					{ file: "forest.png", title: "Forest", category: "Nature" },
					{ file: "office.png", title: "Office", category: "Work" },
				],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<PhotosTab />);

		await screen.findByRole("button", { name: "Forest Forest" });
		const source = document.querySelector<HTMLElement>(
			'[data-photo-file="forest.png"]',
		);
		const destination = document.querySelector<HTMLElement>(
			'[data-category-path="Work"]',
		);
		expect(source).not.toBeNull();
		expect(destination).not.toBeNull();
		expect(source).toHaveAttribute("draggable", "true");

		const values = new Map<string, string>();
		const dataTransfer = {
			types: [] as string[],
			effectAllowed: "none",
			dropEffect: "none",
			setDragImage: vi.fn(),
			setData(type: string, value: string) {
				values.set(type, value);
				if (!this.types.includes(type)) this.types.push(type);
			},
			getData(type: string) {
				return values.get(type) ?? "";
			},
		};

		fireEvent.dragStart(source as HTMLElement, { dataTransfer });
		expect(dataTransfer.effectAllowed).toBe("move");
		expect(dataTransfer.setDragImage).toHaveBeenCalledOnce();
		expect(dataTransfer.setDragImage.mock.calls[0]?.[0]).toHaveAttribute(
			"data-photo-drag-preview",
		);
		fireEvent.dragOver(destination as HTMLElement, { dataTransfer });
		expect(dataTransfer.dropEffect).toBe("move");
		expect(destination).toHaveClass("ring-2");
		fireEvent.drop(destination as HTMLElement, { dataTransfer });

		expect(wsMocks.wsSend).toHaveBeenCalledWith({
			type: "update_asset_category",
			filename: "forest.png",
			category: "Work",
		});
		expect(destination).not.toHaveClass("ring-2");

		useStore
			.getState()
			.applyAssetCategoryUpdates([
				{ filename: "forest.png", category: "Work" },
			]);
		await waitFor(() =>
			expect(
				document
					.querySelector('[data-photo-file="forest.png"]')
					?.closest('[data-photo-category="Work"]'),
			).not.toBeNull(),
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("handles empty-library drag and upload flows", async () => {
		const user = userEvent.setup();
		const addPending = vi.fn(async () => ({ ok: true as const }));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ json: async () => ({ images: [] }) })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({
				json: async () => ({ images: [{ file: "uploaded.png" }] }),
			});
		vi.stubGlobal("fetch", fetchMock);
		useStore.setState({ addPending });
		render(<PhotosTab />);

		const empty = await screen.findByRole("button", { name: /No images/ });
		const upload = screen.getByRole("button", { name: "Upload images" });
		fireEvent.dragOver(upload, {
			dataTransfer: { files: [], types: ["text/plain"] },
		});
		fireEvent.dragOver(upload, {
			dataTransfer: { files: [], types: ["Files"] },
		});
		fireEvent.dragLeave(upload);
		fireEvent.dragOver(empty, {
			dataTransfer: { files: [], types: ["Files"] },
		});
		fireEvent.dragLeave(empty);
		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;
		await user.upload(
			input,
			new File(["image"], "uploaded.png", { type: "image/png" }),
		);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		expect(addPending).toHaveBeenCalledWith(
			expect.objectContaining({ type: "classify-images" }),
		);
	});
});

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "reports",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-1`, name: "Page 1", elements: [] }],
		activePage: 0,
	};
}
