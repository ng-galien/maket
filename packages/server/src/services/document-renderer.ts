import type { DocumentStateClientView } from "@maket/shared";
import type { CollectionRenderOptions } from "../lib/collection-render.js";
import type { Document } from "../types.js";
import type { CollectionRenderer } from "./collection-renderer.js";
import type { StatePageProjection, StateRenderer } from "./state-renderer.js";
import type { StructuredWorkspaces } from "./structured-workspaces.js";

export interface DocumentRenderOptions {
	/** Omit to preserve the raw collection template, as thumbnail/snapshot did
	 * before document-state rendering existed. */
	collection?: CollectionRenderOptions;
	structuredWorkspace?: {
		workspaceId: string;
		collectionId: string;
	};
}

export interface DocumentRenderer {
	render(doc: Document, options?: DocumentRenderOptions): Document;
	stateView(doc: Document): DocumentStateClientView | null;
	statePages(doc: Document, paths: string[]): StatePageProjection[];
}

export interface DocumentRendererDeps {
	collectionRenderer: CollectionRenderer;
	stateRenderer: StateRenderer;
	structuredWorkspaces: Pick<StructuredWorkspaces, "renderCollection">;
}

export function createDocumentRenderer(
	deps: DocumentRendererDeps,
): DocumentRenderer {
	return {
		render(doc, options = {}) {
			const structuredWorkspace =
				options.structuredWorkspace ??
				(doc.meta.structuredWorkspace?.role === "collection"
					? {
							workspaceId: doc.meta.structuredWorkspace.workspaceId,
							collectionId: doc.meta.structuredWorkspace.collectionId,
						}
					: undefined);
			if (structuredWorkspace) {
				return deps.structuredWorkspaces.renderCollection(
					structuredWorkspace.workspaceId,
					structuredWorkspace.collectionId,
				);
			}
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
			const ownership = doc.meta.structuredWorkspace;
			if (ownership?.role === "collection") {
				return deps.structuredWorkspaces
					.renderCollection(ownership.workspaceId, ownership.collectionId)
					.pages.map((page, index) => ({ index, html: page.html }));
			}
			return doc.dataModel === "state"
				? deps.stateRenderer.renderPages(doc, paths)
				: [];
		},
	};
}
