import { resolveDocumentStateText } from "@maket/shared";
import type { Document } from "../types.js";
import type { DocumentStates } from "./document-states.js";

export interface StateRenderer {
	render(doc: Document): Document;
}

export interface StateRendererDeps {
	documentStates: Pick<DocumentStates, "get">;
}

export function createStateRenderer(deps: StateRendererDeps): StateRenderer {
	return {
		render(doc) {
			if (doc.dataModel !== "state") {
				throw new Error(`Document "${doc.name}" is not state-backed.`);
			}
			const state = deps.documentStates.get(doc.name);
			if (!state) throw new Error(`Document "${doc.name}" has no state.`);
			return {
				...doc,
				pages: doc.pages.map((page) => ({
					...page,
					html: page.html
						? resolveDocumentStateText(page.html, state.current.data)
						: undefined,
				})),
			};
		},
	};
}
