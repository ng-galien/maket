import type { DocumentStateClientView } from "@maket/shared";
import type { CollectionRenderOptions } from "../lib/collection-render.js";
import type { Document } from "../types.js";
import type { CollectionRenderer } from "./collection-renderer.js";
import type { StatePageProjection, StateRenderer } from "./state-renderer.js";

export interface DocumentRenderOptions {
	/** Omit to preserve the raw collection template, as thumbnail/snapshot did
	 * before document-state rendering existed. */
	collection?: CollectionRenderOptions;
}

export interface DocumentRenderer {
	render(doc: Document, options?: DocumentRenderOptions): Document;
	stateView(doc: Document): DocumentStateClientView | null;
	statePages(doc: Document, paths: string[]): StatePageProjection[];
}

export interface DocumentRendererDeps {
	collectionRenderer: CollectionRenderer;
	stateRenderer: StateRenderer;
}

export function createDocumentRenderer(
	deps: DocumentRendererDeps,
): DocumentRenderer {
	return {
		render(doc, options = {}) {
			switch (doc.dataModel) {
				case "state":
					return deps.stateRenderer.render(doc);
				case "collection":
					return options.collection
						? deps.collectionRenderer.render(doc, options.collection)
						: doc;
				default:
					return doc;
			}
		},
		stateView(doc) {
			return doc.dataModel === "state"
				? deps.stateRenderer.clientView(doc)
				: null;
		},
		statePages(doc, paths) {
			return doc.dataModel === "state"
				? deps.stateRenderer.renderPages(doc, paths)
				: [];
		},
	};
}
