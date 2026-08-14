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

	it("recalculates the focused frame when the workspace expands but not when it shrinks", async () => {
		render(<Board locked={false} />);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1));

		act(() => useStore.getState().addDocToWorkspace("gamma"));
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(2));
		expect(zoomSpies.requestFit).toHaveBeenLastCalledWith({
			docName: "alpha",
			pageIndex: 0,
		});

		act(() => useStore.getState().removeDocFromWorkspace("gamma"));
		expect(zoomSpies.requestFit).toHaveBeenCalledTimes(2);
		expect(zoomSpies.cancelFitForWorkspaceRemoval).toHaveBeenCalledOnce();
	});

	it("keeps the camera steady when the focused document is closed", async () => {
		render(<Board locked={false} />);
		await waitFor(() => expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1));

		act(() => useStore.getState().removeDocFromWorkspace("alpha"));

		expect(useStore.getState().focusedDocName).toBe("beta");
		expect(zoomSpies.requestFit).toHaveBeenCalledTimes(1);
		expect(zoomSpies.cancelFitForWorkspaceRemoval).toHaveBeenCalledOnce();
	});
});
