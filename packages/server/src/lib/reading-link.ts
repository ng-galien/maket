/**
 * The reading path of a document: the page of Maket that shows it, by its
 * stable id, under the configured base path, with the Workspace and the
 * collection of a Structured Workspace document. Tools give it beside what
 * they produce so any client can open the result in Maket.
 */

import type { Document } from "../types.js";

export function documentReadingPath(
	document: Pick<Document, "id" | "meta">,
	basePath: string | undefined,
): string {
	const path = `${basePath ?? ""}/documents/${encodeURIComponent(document.id)}/read`;
	const owner = document.meta?.structuredWorkspace;
	if (!owner) return path;
	const collection =
		owner.role !== "template"
			? `&collection=${encodeURIComponent(owner.collectionId)}`
			: "";
	return `${path}?workspace=${encodeURIComponent(owner.workspaceId)}${collection}`;
}

/** The line that gives a reading path to the agent and the user. */
export function readingLine(path: string): string {
	return `Read it in Maket: ${path} (a relative path: it opens in the Maket app, or in a browser on the Maket server origin).`;
}
