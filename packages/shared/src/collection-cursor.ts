/**
 * Collection cursor — the shared preview state of a page↔collection binding.
 *
 * A page bound to a collection is previewed through a cursor: which render
 * mode is active and which member (row) is current. The cursor is keyed by
 * (docName, pageIndex) — NOT by collection — so two pages bound to the same
 * collection hold independent cursors.
 *
 * The server owns this state (see `packages/server/src/services/collection-cursor.ts`);
 * browsers mutate it with the `collection_cursor_set` WS command and mirror
 * it from `state` pushes / `collection_cursors` signals. MCP exposes the same
 * state through `maket_collection action=cursor`, so the human, the agent and
 * the exports all read one value.
 */

export type CollectionCursorMode = "template" | "rendered" | "all";

export interface PageCollectionCursor {
	docName: string;
	pageIndex: number;
	/** Name of the bound collection at the time the cursor was set. */
	collection: string;
	mode: CollectionCursorMode;
	/** Current member id, or null when the collection has no rows. */
	memberId: string | null;
}

export const collectionCursorModes = [
	"template",
	"rendered",
	"all",
] as const satisfies readonly CollectionCursorMode[];

export function isCollectionCursorMode(
	value: unknown,
): value is CollectionCursorMode {
	return (
		typeof value === "string" &&
		(collectionCursorModes as readonly string[]).includes(value)
	);
}

/** Stable map key for a page-scoped cursor. Doc names may contain any
 * printable character, so the separator is the NUL control char. */
export function collectionCursorKey(
	docName: string,
	pageIndex: number,
): string {
	return `${docName}\0${pageIndex}`;
}
