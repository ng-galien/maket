import type { Document, Page } from "../types.js";

export function templateControlledPageMessage(
	document: Document,
	page: Page,
): string | null {
	if (page.provenance?.kind !== "template") return null;
	return `Page "${page.name ?? "Untitled"}" in "${document.name}" is controlled by its Structured Workspace template. Edit the template and call maket_structured_workspace action=sync_template workspace=<workspace>.`;
}

export function documentDuplicationBlockMessage(
	document: Document,
): string | null {
	if (document.dataModel !== "state" && !document.meta.structuredWorkspace) {
		return null;
	}
	return `Document "${document.name}" is state-backed or owned by a Structured Workspace and cannot be duplicated.`;
}
