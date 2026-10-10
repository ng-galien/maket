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
		const stateRenderer = {
			render: vi.fn((value) => value),
			renderPages: vi.fn(() => ({ pages: [], flowed: false })),
			clientView: vi.fn(),
		};
		const renderer = createDocumentRenderer({
			collectionRenderer,
			stateRenderer,
			structuredWorkspaces: { renderCollection: vi.fn() },
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
			structuredWorkspaces: { renderCollection: vi.fn() },
			stateRenderer: {
				render: (value) => value,
				renderPages: () => ({ pages: [], flowed: false }),
				clientView: () => ({
					schema: {},
					data: {},
					revision: 1,
					createdAt: "",
					templates: {},
				}),
			},
		});

		expect(renderer.render(collection)).toBe(collection);
		expect(collectionRenderer.render).not.toHaveBeenCalled();
	});

	it("delegates Structured Workspace collection composition", () => {
		const collection = doc("static");
		const rendered = { ...collection, name: "Rendered collection" };
		const renderCollection = vi.fn(() => rendered);
		const renderer = createDocumentRenderer({
			collectionRenderer: { render: vi.fn((value) => value) },
			stateRenderer: {
				render: vi.fn((value) => value),
				renderPages: vi.fn(() => ({ pages: [], flowed: false })),
				clientView: vi.fn(),
			},
			structuredWorkspaces: { renderCollection },
		});

		expect(
			renderer.render(collection, {
				structuredWorkspace: {
					workspaceId: "delivery",
					collectionId: "backlog",
				},
			}),
		).toBe(rendered);
		expect(renderCollection).toHaveBeenCalledWith("delivery", "backlog");
	});

	it("renders a persisted collection instance from its ownership metadata", () => {
		const collection = doc("collection");
		collection.meta.structuredWorkspace = {
			role: "collection",
			workspaceId: "delivery",
			collectionId: "backlog",
		};
		const rendered = { ...collection, name: "Hydrated backlog" };
		const renderCollection = vi.fn(() => rendered);
		const renderer = createDocumentRenderer({
			collectionRenderer: { render: vi.fn((value) => value) },
			stateRenderer: {
				render: vi.fn((value) => value),
				renderPages: vi.fn(() => ({ pages: [], flowed: false })),
				clientView: vi.fn(),
			},
			structuredWorkspaces: { renderCollection },
		});

		expect(renderer.render(collection)).toBe(rendered);
		expect(renderCollection).toHaveBeenCalledWith("delivery", "backlog");
	});

	it("projects a freshly composed collection after a live state change", () => {
		const collection = doc("state");
		collection.meta.structuredWorkspace = {
			role: "collection",
			workspaceId: "delivery",
			collectionId: "backlog",
		};
		const rendered = {
			...collection,
			pages: [
				{
					id: "board",
					name: "Board",
					elements: [],
					html: "<article>Updated card</article>",
				},
			],
		};
		const renderCollection = vi.fn(() => rendered);
		const renderPages = vi.fn(() => ({ pages: [], flowed: false }));
		const renderer = createDocumentRenderer({
			collectionRenderer: { render: vi.fn((value) => value) },
			stateRenderer: {
				render: vi.fn((value) => value),
				renderPages,
				clientView: vi.fn(),
			},
			structuredWorkspaces: { renderCollection },
		});

		expect(renderer.statePages(collection, [""])).toEqual({
			pages: [
				{
					index: 0,
					id: "board",
					name: "Board",
					html: "<article>Updated card</article>",
				},
			],
			pageCount: 1,
		});
		expect(renderCollection).toHaveBeenCalledWith("delivery", "backlog");
		expect(renderPages).not.toHaveBeenCalled();
	});
});
