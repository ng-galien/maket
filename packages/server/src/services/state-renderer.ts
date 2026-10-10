import {
	type DocumentStateClientView,
	jsonPointersIntersect,
	renderDocumentStatePage,
	type StatePageProjection,
} from "@maket/shared";
import type { Document, Page } from "../types.js";
import type { DocumentStates, DocumentStateView } from "./document-states.js";
import {
	type FlowRanges,
	flowedPageIdentity,
	markFlowedPage,
	type PageFlow,
	remapPageLinkNumbers,
} from "./page-flow.js";

export interface StatePagesRender {
	pages: StatePageProjection[];
	/** True when a list flows onto continuation pages: `pages` then holds every
	 * rendered page with its identity. */
	flowed: boolean;
}

export interface StateRenderer {
	render(doc: Document): Document;
	renderPages(doc: Document, paths: string[]): StatePagesRender;
	clientView(doc: Document): DocumentStateClientView;
}

export interface StateRendererDeps {
	documentStates: Pick<DocumentStates, "get">;
	pageFlow?: Pick<PageFlow, "pages">;
}

interface RenderedSourcePage {
	pages: Page[];
	dependencies: string[];
}

const FLOW_MARKER = /<!--\/?maket-flow(?::\d+:\d+)?-->/g;

export function stripFlowMarkers(html: string): string {
	return html.replace(FLOW_MARKER, "");
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

	function renderSourcePage(
		doc: Document,
		page: Page,
		state: DocumentStateView,
	): RenderedSourcePage {
		if (!page.html && !page.jsonForms)
			return { pages: [{ ...page, html: undefined }], dependencies: [] };
		const { data, schema } = state.current;
		if (!page.html || !deps.pageFlow) {
			const rendered = renderDocumentStatePage(page, data, { schema });
			return {
				pages: [{ ...page, html: rendered.html }],
				dependencies: rendered.dependencies,
			};
		}
		const renderMarked = (ranges?: FlowRanges) => {
			const rendered = renderDocumentStatePage(page, data, {
				schema,
				flow: { mark: true, ranges },
			});
			return {
				html: rendered.html,
				lists: rendered.flowLists ?? [],
				dependencies: rendered.dependencies,
			};
		};
		const full = renderMarked();
		const plan = deps.pageFlow.pages({
			doc,
			pageKey: page.id,
			full,
			render: renderMarked,
		});
		if (!plan) {
			return {
				pages: [{ ...page, html: stripFlowMarkers(full.html) }],
				dependencies: full.dependencies,
			};
		}
		return {
			pages: plan.map((ranges, index) => ({
				...page,
				...flowedPageIdentity(page, index),
				html: markFlowedPage(
					stripFlowMarkers(renderMarked(ranges).html),
					index,
					plan.length,
				),
			})),
			dependencies: full.dependencies,
		};
	}

	function renderAll(doc: Document): RenderedSourcePage[] {
		const state = stateView(doc);
		const rendered = doc.pages.map((page) =>
			renderSourcePage(doc, page, state),
		);
		if (rendered.every((source) => source.pages.length === 1)) return rendered;
		const sourceStarts: number[] = [];
		let next = 0;
		for (const source of rendered) {
			sourceStarts.push(next);
			next += source.pages.length;
		}
		return rendered.map((source) => ({
			...source,
			pages: source.pages.map((page) =>
				page.html
					? { ...page, html: remapPageLinkNumbers(page.html, sourceStarts) }
					: page,
			),
		}));
	}

	return {
		render(doc) {
			return {
				...doc,
				pages: renderAll(doc).flatMap((source) => source.pages),
			};
		},
		renderPages(doc, paths) {
			const rendered = renderAll(doc);
			if (rendered.some((source) => source.pages.length > 1)) {
				return {
					flowed: true,
					pages: rendered
						.flatMap((source) => source.pages)
						.map((page, index) => ({
							index,
							id: page.id,
							name: page.name,
							html: page.html,
						})),
				};
			}
			return {
				flowed: false,
				pages: rendered.flatMap((source, index) => {
					const affected =
						paths.includes("") ||
						source.dependencies.some((dependency) =>
							paths.some((path) => jsonPointersIntersect(path, dependency)),
						);
					return affected ? [{ index, html: source.pages[0]?.html }] : [];
				}),
			};
		},
		clientView(doc) {
			const state = stateView(doc);
			return {
				schema: state.current.schema,
				data: state.current.data,
				revision: state.current.revision,
				createdAt: state.current.createdAt,
				templates: Object.fromEntries(
					doc.pages.flatMap((page) => {
						if (page.html) return [[page.id, page.html]];
						if (page.jsonForms)
							return [
								[
									page.id,
									renderDocumentStatePage(page, state.current.data, {
										schema: state.current.schema,
									}).html,
								],
							];
						return [];
					}),
				),
			};
		},
	};
}
