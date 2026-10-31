import type { Document, Page } from "../types.js";

/** Projections inherit presentation from their template; only this one
 * document-level option may be updated directly on an owned template. */
export function canUpdateDocumentMetadata(
	document: Document,
	changes: Record<string, unknown>,
): boolean {
	if (
		changes.responsive !== undefined &&
		typeof changes.responsive !== "boolean"
	)
		return false;
	const owner = document.meta.structuredWorkspace;
	if (!owner) return true;
	const keys = Object.keys(changes).filter((key) => changes[key] !== undefined);
	return (
		owner.role === "template" && keys.length === 1 && keys[0] === "responsive"
	);
}

/** Refusal for any edit of a locked document; null when it is unlocked. */
export function lockedDocumentMessage(document: Document): string | null {
	if (document.meta?.locked !== true) return null;
	return `🔒 Document "${document.name}" is locked — edits are refused. Ask the user to unlock it, or call: maket_workspace action=lock doc=${document.name} locked=false`;
}

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

/** Whether a document renders one Structured Workspace item; such documents
 * stay out of the library and of document search. */
export function isStructuredWorkspaceItem(document: Document): boolean {
	const owner = document.meta.structuredWorkspace;
	if (!owner || owner.role === "collection" || owner.role === "template")
		return false;
	return Boolean(owner.itemId);
}
