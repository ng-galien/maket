/**
 * Populate the workspace store from a decoded `.maket` bundle. The viewer
 * never opens a WebSocket, so this is the store's only data source: asset
 * references are rewritten to object URLs up front, then documents, chartes
 * and collections are swapped in atomically with `readOnly` set.
 */

import { renderDocumentStateText } from "@maket/shared";
import type { DocSummary, Document } from "../store/types";
import { useStore } from "../store/useStore";
import { ensureCharteFonts } from "../store/ws";
import { rewriteAssetRefs, type ViewerWorkspace } from "./bundle";
import { stripActiveHtml, stripNetworkCss } from "./strip-active-html";

/**
 * Bundles are untrusted, so charte `@import` font URLs are only honoured for
 * well-known font CDNs — anything else would let a crafted file trigger
 * requests to arbitrary hosts the moment it is opened.
 */
const TRUSTED_FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.bunny.net"]);

function trustedFontImports(charteCss: string): string {
	const imports = charteCss.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)/g);
	const kept: string[] = [];
	for (const m of imports) {
		try {
			const url = new URL(m[1]);
			if (url.protocol === "https:" && TRUSTED_FONT_HOSTS.has(url.hostname)) {
				kept.push(m[0]);
			}
		} catch {}
	}
	return kept.join("\n");
}

function toDocSummary(doc: Document): DocSummary {
	return {
		id: doc.id,
		name: doc.name,
		category: doc.category,
		format: doc.canvas?.format ?? `${doc.canvas?.w}×${doc.canvas?.h}mm`,
		pageCount: doc.pages.length,
		elementCount: doc.pages.reduce((n, p) => n + (p.elements?.length ?? 0), 0),
		orientation: doc.canvas?.orientation,
		charte: doc.meta?.charte,
	};
}

function hydrateDocuments(
	workspace: ViewerWorkspace,
	charteCssByName: Map<string, string>,
): { docs: Map<string, Document>; chartesCss: Map<string, string> } {
	const docs = new Map<string, Document>();
	const chartesCss = new Map<string, string>();
	for (const doc of workspace.documents) {
		const stateView = workspace.documentStates[doc.name];
		const pages = doc.pages.map((page) => ({
			...page,
			html: page.html
				? stripActiveHtml(
						rewriteAssetRefs(
							doc.dataModel === "state" && stateView
								? renderDocumentStateText(page.html, stateView.data, {
										schema: stateView.schema,
									}).html
								: page.html,
							workspace.assetUrls,
						),
					)
				: page.html,
		}));
		docs.set(doc.name, { ...doc, pages });
		const charteName = doc.meta?.charte;
		const css = charteName ? (charteCssByName.get(charteName) ?? "") : "";
		chartesCss.set(
			doc.name,
			stripNetworkCss(rewriteAssetRefs(css, workspace.assetUrls)),
		);
		if (css) ensureCharteFonts(trustedFontImports(css));
	}
	return { docs, chartesCss };
}

export function hydrateViewerWorkspace(workspace: ViewerWorkspace): void {
	const charteCssByName = new Map(
		workspace.chartes.map((charte) => [charte.name, charte.css ?? ""]),
	);
	const { docs, chartesCss } = hydrateDocuments(workspace, charteCssByName);
	const state = useStore.getState();
	useStore.setState({
		readOnly: true,
		docs,
		docList: workspace.documents.map(toDocSummary),
		chartesCss,
		chartesVersion: state.chartesVersion + 1,
		workspaceDocNames: workspace.documents.map((d) => d.name),
		focusedDocName: workspace.documents[0]?.name ?? null,
		selectedIds: [],
		editingElementId: null,
		pending: [],
		documentStates: workspace.documentStates,
		stateCanvasModes: Object.fromEntries(
			Object.keys(workspace.documentStates).map((name) => [name, "live"]),
		),
		statePatchPending: {},
		statePatchRequests: {},
		statePatchErrors: {},
	});
	state.setCollections(workspace.collections);
}
