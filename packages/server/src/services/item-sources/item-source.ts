/**
 * ItemSource — where the items of a Structured Workspace live. The engine
 * reads items through this contract only; each connector (Maket's own
 * storage first) implements it with a factory.
 *
 * `list` answers one batch of a query by cursor; `get` one whole item. Both
 * answer synchronously: the index composition and the workspace views they
 * feed are synchronous, so a connector serves them from what it holds and
 * fetches in `refresh`. Writes, `refresh` and `close` are asynchronous.
 */

import type {
	StructuredWorkspaceGroupValue,
	StructuredWorkspaceItemDataIssue,
} from "@maket/shared";

export interface ItemSourceCapabilities {
	readOnly: boolean;
	create: boolean;
	delete: boolean;
	search: boolean;
	sort: "pushdown" | "memory";
	total: "exact" | "estimate" | "none";
	changes: "push" | "poll" | "none";
	revisions: "local" | "source" | "none";
}

export interface ItemQueryFilter {
	/** JSON Pointer into item data. */
	field: string;
	op: "eq" | "in";
	value: StructuredWorkspaceGroupValue | StructuredWorkspaceGroupValue[];
}

export interface ItemQuery {
	collectionId: string;
	text?: string;
	filters?: ItemQueryFilter[];
	sort?: { field: string; direction: "ascending" | "descending" };
	groupBy?: string;
	/** Opaque position returned as `next` by the previous batch of the same
	 * query; never read by callers. */
	cursor?: string;
	/** Most items in the batch; the source may answer fewer and caps it. */
	limit: number;
}

/** One item as the index needs it: `fields` holds only the data keys the
 * index reads (compact templates, index pages, sort and group). */
export interface ItemSummary {
	id: string;
	revision: string;
	bindingId: string;
	fields: Record<string, unknown>;
	issues?: StructuredWorkspaceItemDataIssue[];
}

/** One batch of a query: a new query restarts from the first item, `next`
 * continues it and is absent once the query is exhausted. */
export interface ItemPage {
	items: ItemSummary[];
	next?: string;
	/** Items matching the query, when `capabilities().total` is not none. */
	total?: number;
	/** Items per group value over the whole query, in index order. */
	groups?: Array<{ value: StructuredWorkspaceGroupValue; count: number }>;
}

/** One item with its whole data and the revision a write must expect. */
export interface ItemRecord {
	id: string;
	revision: string;
	bindingId: string;
	data: Record<string, unknown>;
}

export interface ItemCreation {
	collectionId: string;
	bindingId: string;
	data: Record<string, unknown>;
	id?: string;
	/** The document that will render the item, for a source that records it. */
	document?: { id: string; name: string };
}

export type ItemRefreshTarget =
	| { scope: "index" }
	| { scope: "item"; id: string };

export type ItemSourceErrorCode =
	| "source_unreachable"
	| "stale_revision"
	| "unknown_item"
	| "read_only"
	| "query_unsupported"
	| "invalid_record"
	| "unknown_workspace"
	| "unknown_collection";

/** A connector failure the engine translates for the client and the agent. */
export interface ItemSourceError extends Error {
	code: ItemSourceErrorCode;
	/** Seconds before an unreachable source is worth asking again. */
	retryAfter?: number;
	/** The revision a stale write should have expected. */
	currentRevision?: string;
}

export interface ItemSource {
	/** What the source supports; the engine never asks for more. */
	capabilities(): ItemSourceCapabilities;
	/** One batch of item summaries matching the query, in index order. */
	list(query: ItemQuery): ItemPage;
	/** The whole current data of one item, or null when the source has no such item. */
	get(id: string): ItemRecord | null;
	/** Add an item; only when `capabilities().create` is true. */
	create?(input: ItemCreation): Promise<ItemRecord>;
	/** Replace an item's data at `expectedRevision`, else fail with stale_revision. */
	put?(
		id: string,
		data: Record<string, unknown>,
		expectedRevision: string,
	): Promise<ItemRecord>;
	/** Remove an item, at `expectedRevision` when given; only when `capabilities().delete` is true. */
	delete?(id: string, expectedRevision?: string): Promise<void>;
	/** Re-read the index or one item from the source and announce it on the bus. */
	refresh(target: ItemRefreshTarget): Promise<void>;
	/** Release what the source holds; later reads fail with source_unreachable. */
	close(): Promise<void>;
}
