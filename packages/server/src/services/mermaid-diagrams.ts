import { refreshMermaidHtml } from "../lib/mermaid-document.js";
import type { Documents } from "./documents.js";

export interface MermaidDiagramRefresh {
	docNames: string[];
	errors: Array<{ docName: string; page: number; message: string }>;
}

export interface MermaidDiagrams {
	refreshCharte(name: string): MermaidDiagramRefresh;
	refreshDocument(docName: string): MermaidDiagramRefresh;
}

export interface MermaidDiagramsDeps {
	documents: Documents;
}

function refreshDocument(
	documents: Documents,
	docName: string,
): MermaidDiagramRefresh {
	const doc = documents.resolve(docName);
	if (!doc) return { docNames: [], errors: [] };
	const errors: MermaidDiagramRefresh["errors"] = [];
	const resolvedCharte = documents.charte(doc);
	let changed = false;
	for (const [pageIndex, page] of doc.pages.entries()) {
		const result = refreshMermaidHtml(page.html ?? "", resolvedCharte);
		if (result.refreshed > 0) {
			page.html = result.html;
			changed = true;
		}
		for (const message of result.errors) {
			errors.push({ docName: doc.name, page: pageIndex + 1, message });
		}
	}
	if (!changed) return { docNames: [], errors };
	try {
		documents.persist(doc.name);
		return { docNames: [doc.name], errors };
	} catch (error) {
		errors.push({
			docName: doc.name,
			page: 0,
			message: error instanceof Error ? error.message : String(error),
		});
		return { docNames: [], errors };
	}
}

// Charte-driven rerendering intentionally coordinates document lookup, HTML rendering, and atomic persistence.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
function refreshCharteDocuments(
	documents: Documents,
	name: string,
): MermaidDiagramRefresh {
	const docNames: string[] = [];
	const errors: MermaidDiagramRefresh["errors"] = [];
	for (const doc of documents.all().values()) {
		if (doc.meta.charte !== name) continue;
		const result = refreshDocument(documents, doc.name);
		docNames.push(...result.docNames);
		errors.push(...result.errors);
	}
	return { docNames, errors };
}

export function createMermaidDiagrams({
	documents,
}: MermaidDiagramsDeps): MermaidDiagrams {
	return {
		refreshCharte: (name) => refreshCharteDocuments(documents, name),
		refreshDocument: (docName) => refreshDocument(documents, docName),
	};
}
