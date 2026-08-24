import { type Collection, collectionCursorKey } from "@maket/shared";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";

const zoomSpies = vi.hoisted(() => ({
	requestFit: vi.fn(),
	cancelFitForWorkspaceRemoval: vi.fn(),
}));

vi.mock("../store/zoomBridge", () => ({
	consumePendingFit: () => null,
	consumeWorkspaceRemovalFitSuppression: () => false,
	registerCancelFit: vi.fn(),
	registerFitToDoc: vi.fn(),
	registerFitToView: vi.fn(),
	registerRequestFit: vi.fn(),
	registerZoomTo: vi.fn(),
	requestFit: zoomSpies.requestFit,
	cancelFitForWorkspaceRemoval: zoomSpies.cancelFitForWorkspaceRemoval,
}));

const { Board } = await import("./Board");

class ResizeObserverMock {
	observe() {}
	disconnect() {}
}

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "reports",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [
			{ id: `${name}-1`, name: "Page 1", elements: [] },
			{ id: `${name}-2`, name: "Page 2", elements: [] },
		],
		activePage: 0,
	};
}

const clients: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { name: { type: "string" } },
		required: ["name"],
		additionalProperties: false,
	},
	members: [
		{ id: "one", position: 0, data: { name: "One" } },
		{ id: "two", position: 1, data: { name: "Two" } },
		{ id: "three", position: 2, data: { name: "Three" } },
	],
};

beforeEach(() => {
	zoomSpies.requestFit.mockReset();
	zoomSpies.cancelFitForWorkspaceRemoval.mockReset();
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);
	const alpha = makeDoc("alpha");
	const beta = makeDoc("beta");
	const gamma = makeDoc("gamma");
	useStore.setState({
		docs: new Map([
			[alpha.name, alpha],
			[beta.name, beta],
			[gamma.name, gamma],
		]),
		collections: [],
		collectionCursors: {},
		collectionDrafts: {},
		draftCursorOverrides: {},
		workspaceDocNames: [alpha.name, beta.name],
		focusedDocName: alpha.name,
		focusedPageIndex: 0,
		autoFocusFit: true,
		workspaceView: "canvas",
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("Board automatic focus fit", () => {
	it("tracks document and page focus but respects a disengaged auto-fit", async () => {
		render(<Board locked={false} />);
		await waitFor(() =>
			expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
				docName: "alpha",
				pageIndex: 0,
			}),
		);

		act(() => useStore.getState().setFocusedPage("alpha", 1));
		await waitFor(() =>
			expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
				docName: "alpha",
				pageIndex: 1,
			}),
		);
		const callsWithAutoFit = zoomSpies.requestFit.mock.calls.length;

		act(() => {
			useStore.setState({ autoFocusFit: false });
			useStore.getState().setFocusedDoc("beta");
		});
		expect(zoomSpies.requestFit).toHaveBeenCalledTimes(callsWithAutoFit);
	});

	it("recalculates the focused frame when the workspace expands or shrinks", async () => {
		render(<Board locked={false} />);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1));

		act(() => useStore.getState().addDocToWorkspace("gamma"));
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(2));
		expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
			docName: "alpha",
			pageIndex: 0,
		});

		act(() => useStore.getState().closeWorkspaceDocuments(["gamma"]));
		expect(zoomSpies.requestFit).toHaveBeenCalledTimes(3);
		expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
			docName: "alpha",
			pageIndex: 0,
		});
		expect(zoomSpies.cancelFitForWorkspaceRemoval).toHaveBeenCalledOnce();
	});

	it("reframes the next document when the focused document is closed", async () => {
		render(<Board locked={false} />);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1));

		act(() => useStore.getState().closeWorkspaceDocuments(["alpha"]));

		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(zoomSpies.requestFit).toHaveBeenCalledTimes(2);
		expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
			docName: "beta",
			pageIndex: 0,
		});
		expect(zoomSpies.cancelFitForWorkspaceRemoval).toHaveBeenCalledOnce();
	});

	it("reframes the whole document when its collection render count changes", async () => {
		const currentAlpha = useStore.getState().docs.get("alpha");
		const [firstPage, ...otherPages] = currentAlpha?.pages ?? [];
		if (!currentAlpha || !firstPage)
			throw new Error("alpha collection fixture is missing");
		const alpha = {
			...currentAlpha,
			pages: [
				{ ...firstPage, collection: { name: clients.name } },
				...otherPages,
			],
		};
		const cursorKey = collectionCursorKey(alpha.name, 0);
		useStore.setState({
			docs: new Map(useStore.getState().docs).set(alpha.name, alpha),
			collections: [clients],
			collectionCursors: {
				[cursorKey]: {
					docName: alpha.name,
					pageIndex: 0,
					collection: clients.name,
					mode: "all",
					memberId: "one",
				},
			},
		});
		render(<Board locked={false} />);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1));

		act(() =>
			useStore.getState().setCollections([
				{
					...clients,
					members: [
						...clients.members,
						{ id: "four", position: 3, data: { name: "Four" } },
					],
				},
			]),
		);

		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(2));
		expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
			docName: "alpha",
		});
	});

	it("reframes the whole document when the collection display mode changes", async () => {
		const currentAlpha = useStore.getState().docs.get("alpha");
		const firstPage = currentAlpha?.pages[0];
		if (!currentAlpha || !firstPage)
			throw new Error("alpha collection fixture is missing");
		useStore.setState({
			docs: new Map(useStore.getState().docs).set(currentAlpha.name, {
				...currentAlpha,
				pages: [
					{ ...firstPage, collection: { name: clients.name } },
					...currentAlpha.pages.slice(1),
				],
			}),
			collections: [clients],
			collectionCursors: {
				[collectionCursorKey(currentAlpha.name, 0)]: {
					docName: currentAlpha.name,
					pageIndex: 0,
					collection: clients.name,
					mode: "rendered",
					memberId: "one",
				},
			},
		});
		render(<Board locked={false} />);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1));

		act(() =>
			useStore.getState().setCollectionCursors([
				{
					docName: currentAlpha.name,
					pageIndex: 0,
					collection: clients.name,
					mode: "all",
					memberId: "one",
				},
			]),
		);

		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(2));
		expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
			docName: "alpha",
		});
	});

	it("reframes when the focused page gains or loses a collection binding", async () => {
		render(<Board locked={false} />);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1));

		const currentAlpha = useStore.getState().docs.get("alpha");
		const firstPage = currentAlpha?.pages[0];
		if (!currentAlpha || !firstPage)
			throw new Error("alpha collection fixture is missing");
		const cursorKey = collectionCursorKey(currentAlpha.name, 0);
		act(() =>
			useStore.setState({
				docs: new Map(useStore.getState().docs).set(currentAlpha.name, {
					...currentAlpha,
					pages: [
						{ ...firstPage, collection: { name: clients.name } },
						...currentAlpha.pages.slice(1),
					],
				}),
				collections: [clients],
				collectionCursors: {
					[cursorKey]: {
						docName: currentAlpha.name,
						pageIndex: 0,
						collection: clients.name,
						mode: "all",
						memberId: "one",
					},
				},
			}),
		);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(2));

		act(() =>
			useStore.setState({
				docs: new Map(useStore.getState().docs).set(
					currentAlpha.name,
					currentAlpha,
				),
				collectionCursors: {},
			}),
		);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(3));
		expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
			docName: "alpha",
		});
	});

	it("closes the whole workspace atomically through the same camera path", async () => {
		render(<Board locked={false} />);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1));

		act(() => useStore.getState().closeWorkspaceDocuments(["alpha", "beta"]));

		expect(useStore.getState().workspaceDocNames).toEqual([]);
		expect(useStore.getState().focusedDocName).toBeNull();
		expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1);
		expect(zoomSpies.cancelFitForWorkspaceRemoval).toHaveBeenCalledOnce();
	});
});
