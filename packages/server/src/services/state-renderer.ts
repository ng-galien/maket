import {
	type DocumentStateClientView,
	jsonPointersIntersect,
	renderDocumentStateText,
} from "@maket/shared";
import type { Document, Page } from "../types.js";
import type { DocumentStates, DocumentStateView } from "./document-states.js";

export interface StatePageProjection {
	index: number;
	html?: string;
}

export interface StateRenderer {
	render(doc: Document): Document;
	renderPages(doc: Document, paths: string[]): StatePageProjection[];
	clientView(doc: Document): DocumentStateClientView;
}

export interface StateRendererDeps {
	documentStates: Pick<DocumentStates, "get">;
}

export function createStateRenderer(deps: StateRendererDeps): StateRenderer {
	function stateView(doc: Document): DocumentStateView {
		if (doc.dataModel !== "state") {
			throw new Error(`Document "${doc.name}" is not state-backed.`);
		}
		const state = deps.documentStates.get(doc.name);
		if (!state) throw new Error(`Document "${doc.name}" has no state.`);
		return state;
	}

	function renderPage(
		page: Page,
		state: DocumentStateView,
	): { html?: string; dependencies: string[] } {
		if (!page.html) return { html: undefined, dependencies: [] };
		return renderDocumentStateText(page.html, state.current.data, {
			schema: state.current.schema,
		});
	}

	return {
		render(doc) {
			const state = stateView(doc);
			return {
				...doc,
				pages: doc.pages.map((page) => ({
					...page,
					html: renderPage(page, state).html,
				})),
			};
		},
		renderPages(doc, paths) {
			const state = stateView(doc);
			return doc.pages.flatMap((page, index) => {
				const rendered = renderPage(page, state);
				const affected =
					paths.includes("") ||
					rendered.dependencies.some((dependency) =>
						paths.some((path) => jsonPointersIntersect(path, dependency)),
					);
				return affected ? [{ index, html: rendered.html }] : [];
			});
		},
		clientView(doc) {
			const state = stateView(doc);
			return {
				schema: state.current.schema,
				data: state.current.data,
				revision: state.current.revision,
				createdAt: state.current.createdAt,
				templates: Object.fromEntries(
					doc.pages.flatMap((page) =>
						page.html ? [[page.id, page.html]] : [],
					),
				),
			};
		},
	};
}
