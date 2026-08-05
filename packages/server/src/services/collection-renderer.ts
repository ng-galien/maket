import type { CollectionRenderOptions } from "../lib/collection-render.js";
import { renderCollectionDocument } from "../lib/collection-render.js";
import type { Document } from "../types.js";
import type { Collections } from "./collections.js";

export interface CollectionRenderer {
	render(doc: Document, options?: CollectionRenderOptions): Document;
}

export interface CollectionRendererDeps {
	collections: Pick<Collections, "referencedBy">;
}

export function createCollectionRenderer(
	deps: CollectionRendererDeps,
): CollectionRenderer {
	return {
		render(doc, options) {
			const referenced = deps.collections.referencedBy([doc]);
			return renderCollectionDocument(
				doc,
				new Map(referenced.map((collection) => [collection.name, collection])),
				options,
			);
		},
	};
}
