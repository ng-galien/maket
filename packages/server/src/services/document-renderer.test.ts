import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../types.js";
import { createDocumentRenderer } from "./document-renderer.js";

function doc(dataModel: "static" | "collection" | "state") {
	return createDocument({
		name: dataModel,
		dataModel,
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
	});
}

describe("DocumentRenderer", () => {
	it("keeps collection and state rendering as separate strategies", () => {
		const collectionRenderer = { render: vi.fn((value) => value) };
		const stateRenderer = { render: vi.fn((value) => value) };
		const renderer = createDocumentRenderer({
			collectionRenderer,
			stateRenderer,
		});
		const collection = doc("collection");
		const state = doc("state");
		const options = { collection: { collections: {} } };

		renderer.render(collection, options);
		renderer.render(state, options);

		expect(collectionRenderer.render).toHaveBeenCalledWith(
			collection,
			options.collection,
		);
		expect(stateRenderer.render).toHaveBeenCalledWith(state);
		expect(collectionRenderer.render).toHaveBeenCalledTimes(1);
		expect(stateRenderer.render).toHaveBeenCalledTimes(1);
	});

	it("preserves raw collection templates when no projection is requested", () => {
		const collection = doc("collection");
		const collectionRenderer = { render: vi.fn((value) => value) };
		const renderer = createDocumentRenderer({
			collectionRenderer,
			stateRenderer: { render: (value) => value },
		});

		expect(renderer.render(collection)).toBe(collection);
		expect(collectionRenderer.render).not.toHaveBeenCalled();
	});
});
