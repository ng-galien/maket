import type {
	DocumentStateClientView,
	StatePageProjection,
} from "@maket/shared";
import type { CollectionRenderOptions } from "../lib/collection-render.js";
import type { Document } from "../types.js";
import type { CollectionRenderer } from "./collection-renderer.js";
import type { PageFlow } from "./page-flow.js";
import type { StateRenderer } from "./state-renderer.js";
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

export interface StatePagesUpdate {
	pages: StatePageProjection[];
	/** Authoritative rendered page count when the page list itself changes. */
	pageCount?: number;
	/** The rendered page list differs from the authored one (flowed lists):
	 * listeners send the whole document instead of page projections. */
	restructured?: boolean;
}

export interface DocumentRenderer {
	render(doc: Document, options?: DocumentRenderOptions): Document;
	/** `render` once every list flow the document needs is measured. */
	renderSettled(
		doc: Document,
		options?: DocumentRenderOptions,
	): Promise<Document>;
	stateView(doc: Document): DocumentStateClientView | null;
	statePages(doc: Document, paths: string[]): StatePagesUpdate;
}

export interface DocumentRendererDeps {
	collectionRenderer: CollectionRenderer;
	stateRenderer: StateRenderer;
	structuredWorkspaces: Pick<StructuredWorkspaces, "renderCollection">;
	pageFlow?: Pick<PageFlow, "settle">;
}

export function createDocumentRenderer(
	deps: DocumentRendererDeps,
): DocumentRenderer {
	const renderer: DocumentRenderer = {
		async renderSettled(doc, options = {}) {
			renderer.render(doc, options);
			await deps.pageFlow?.settle();
			return renderer.render(doc, options);
		},
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
				const { pages } = deps.structuredWorkspaces.renderCollection(
					ownership.workspaceId,
					ownership.collectionId,
				);
				return {
					pages: pages.map((page, index) => ({
						index,
						id: page.id,
						name: page.name,
						html: page.html,
					})),
					pageCount: pages.length,
				};
			}
			if (doc.dataModel !== "state") return { pages: [] };
			const rendered = deps.stateRenderer.renderPages(doc, paths);
			return rendered.flowed
				? {
						pages: rendered.pages,
						pageCount: rendered.pages.length,
						restructured: true,
					}
				: { pages: rendered.pages };
		},
	};
	return renderer;
}

/** A renderer that may wait for list flows before rendering. */
export type SettlingDocumentRenderer = Pick<DocumentRenderer, "render"> &
	Partial<Pick<DocumentRenderer, "renderSettled">>;

export function renderDocumentSettled(
	renderer: SettlingDocumentRenderer,
	doc: Document,
	options?: DocumentRenderOptions,
): Promise<Document> {
	return renderer.renderSettled
		? renderer.renderSettled(doc, options)
		: Promise.resolve(renderer.render(doc, options));
}
