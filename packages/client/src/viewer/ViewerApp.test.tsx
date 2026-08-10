import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import * as bundle from "./bundle";
import ViewerApp, { viewerOptions } from "./ViewerApp";

beforeEach(() => {
	setLang("en");
	history.replaceState(null, "", "/viewer.html");
	useStore.setState({
		readOnly: false,
		darkMode: false,
		docs: new Map(),
		docList: [],
		workspaceDocNames: [],
		focusedDocName: null,
		focusedPageIndex: 0,
		collections: [],
		documentStates: {},
		stateCanvasModes: {},
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("viewerOptions", () => {
	it("recognises the iframe reader contract", () => {
		expect(
			viewerOptions(
				"?src=%2Fdocuments%2Farticle.maket&doc=article%20principal&embed=1",
			),
		).toEqual({
			src: "/documents/article.maket",
			doc: "article principal",
			embedded: true,
		});
	});

	it("keeps the regular standalone reader when embed is absent", () => {
		expect(viewerOptions("?src=/article.maket")).toEqual({
			src: "/article.maket",
			doc: null,
			embedded: false,
		});
	});

	it("opens a local bundle into the shared Reader and exposes its navigation", async () => {
		const documents = [makeDoc("alpha", 2), makeDoc("beta", 1)];
		vi.spyOn(bundle, "decodeMaketFile").mockResolvedValue({
			version: 2,
			documents,
			chartes: [],
			collections: [],
			documentStates: {},
			assetUrls: new Map(),
		});
		render(<ViewerApp />);
		const file = viewerFile();
		const dropZone =
			screen.getByText("Maket Viewer").parentElement?.parentElement;
		expect(dropZone).not.toBeNull();
		fireEvent.dragOver(dropZone as Element);
		fireEvent.dragLeave(dropZone as Element);
		fireEvent.drop(dropZone as Element, { dataTransfer: { files: [file] } });

		await screen.findByText("alpha page 1");
		expect(useStore.getState().readOnly).toBe(true);
		expect(screen.getByLabelText("Document")).toHaveValue("alpha");
		expect(screen.getByRole("status")).toHaveTextContent("Page 1, 1/2");

		fireEvent.click(screen.getByRole("button", { name: /Next page/ }));
		expect(screen.getByRole("status")).toHaveTextContent("Page 2, 2/2");
		fireEvent.change(screen.getByLabelText("Document"), {
			target: { value: "beta" },
		});
		await screen.findByText("beta page 1");
		fireEvent.click(screen.getByRole("button", { name: "Toggle dark mode" }));
		expect(useStore.getState().darkMode).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Open another file" }));
		fireEvent.change(document.querySelector('input[type="file"]') as Element, {
			target: { files: [viewerFile()] },
		});
		await waitFor(() =>
			expect(bundle.decodeMaketFile).toHaveBeenCalledTimes(2),
		);
	});

	it("reports a bundle decoding error without leaving the drop zone", async () => {
		vi.spyOn(bundle, "decodeMaketFile").mockRejectedValue(
			new Error("Invalid fixture"),
		);
		render(<ViewerApp />);
		fireEvent.change(document.querySelector('input[type="file"]') as Element, {
			target: { files: [viewerFile()] },
		});

		await screen.findByText("Invalid fixture");
		expect(screen.getByText("Maket Viewer")).toBeVisible();
	});
});

function makeDoc(name: string, pageCount: number): Document {
	return {
		id: `doc-${name}`,
		name,
		category: "tests",
		dataModel: "static",
		canvas: { w: 100, h: 100, background: "#fff" },
		pages: Array.from({ length: pageCount }, (_, index) => ({
			id: `${name}-page-${index + 1}`,
			name: `Page ${index + 1}`,
			elements: [],
			html: `<p>${name} page ${index + 1}</p>`,
		})),
		activePage: 0,
	};
}

function viewerFile(): File {
	const file = new File(["fixture"], "fixture.maket", {
		type: "application/zip",
	});
	Object.defineProperty(file, "arrayBuffer", {
		value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
	});
	return file;
}
