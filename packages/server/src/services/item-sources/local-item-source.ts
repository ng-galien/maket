/**
 * The local connector: items stored by Maket itself, one row per item in
 * `structured_workspace_items` holding the item data and its revision. Every
 * read and write goes through those rows; the item documents only render
 * them. Validation, lock guards and bus events stay with the Structured
 * Workspaces engine, which writes through this source.
 */

import crypto from "node:crypto";
import {
	type StructuredWorkspaceCollectionRepresentation,
	type StructuredWorkspaceDataSchema,
	type StructuredWorkspaceDefinition,
	type StructuredWorkspaceGroupValue,
	type StructuredWorkspaceItemDataIssue,
	structuredWorkspaceBindingSchema,
	structuredWorkspaceItemDataIssues,
} from "@maket/shared";
import type { Bus } from "../bus.js";
import type { Documents } from "../documents.js";
import type {
	StoredStructuredWorkspaceItem,
	StructuredWorkspaceRepository,
} from "../sqlite-store/structured-workspace-repository.js";
import { groupItems, sortItems } from "./item-order.js";
import type {
	ItemCreation,
	ItemPage,
	ItemQuery,
	ItemRecord,
	ItemSource,
	ItemSourceCapabilities,
	ItemSummary,
} from "./item-source.js";
import { itemSourceError } from "./item-source-error.js";
import {
	type SummaryFieldRule,
	summaryFieldRule,
	summaryFields,
} from "./summary-fields.js";

export interface LocalItemSourceDeps {
	bus: Bus;
	/** Template documents, read for the summary field rule of each binding. */
	documents: Documents;
	store: StructuredWorkspaceRepository;
}

const localCapabilities: ItemSourceCapabilities = {
	readOnly: false,
	create: true,
	delete: true,
	search: false,
	sort: "memory",
	total: "exact",
	changes: "poll",
	revisions: "local",
};

/** How the items of one binding are summarized and validated. */
interface BindingRead {
	rule: SummaryFieldRule;
	schema: StructuredWorkspaceDataSchema;
}

interface ListedItem {
	summary: ItemSummary;
	data: Record<string, unknown>;
}

export function createLocalItemSource(
	deps: LocalItemSourceDeps,
	workspaceId: string,
): ItemSource {
	let closed = false;
	const open = () => {
		if (closed)
			throw itemSourceError(
				"source_unreachable",
				`The item source of Structured Workspace "${workspaceId}" is closed.`,
			);
	};
	return {
		capabilities: () => ({ ...localCapabilities }),
		list(query) {
			open();
			return listItems(deps, workspaceId, query);
		},
		get(id) {
			open();
			const row = deps.store.loadStructuredWorkspaceItem(workspaceId, id);
			return row ? recordOf(row) : null;
		},
		async create(input) {
			open();
			return createItem(deps, workspaceId, input);
		},
		async put(id, data, expectedRevision) {
			open();
			return putItem(deps, { workspaceId, id }, { data, expectedRevision });
		},
		async delete(id, expectedRevision) {
			open();
			removeItem(deps, { workspaceId, id }, expectedRevision);
		},
		async refresh(target) {
			open();
			deps.bus.emit("structured-workspace:source-changed", {
				workspaceId,
				scope: target.scope,
				...(target.scope === "item" ? { itemId: target.id } : {}),
			});
		},
		async close() {
			closed = true;
		},
	};
}

/** The record of a row, or null when the row holds no data. */
function recordOf(row: StoredStructuredWorkspaceItem): ItemRecord | null {
	if (row.data === null) return null;
	return {
		id: row.id,
		revision: String(row.revision),
		bindingId: row.bindingId,
		data: row.data,
	};
}

/** The record of a row just written, which always holds data. */
function writtenRecord(row: StoredStructuredWorkspaceItem): ItemRecord {
	const record = recordOf(row);
	if (!record)
		throw itemSourceError("invalid_record", `Item "${row.id}" has no data.`);
	return record;
}

const missingData: StructuredWorkspaceItemDataIssue = {
	path: "",
	rule: "missing",
	message: "Item data is missing",
	fix: "Write the item data with update_item, or delete the item.",
};

function listItems(
	deps: LocalItemSourceDeps,
	workspaceId: string,
	query: ItemQuery,
): ItemPage {
	if (query.text !== undefined || (query.filters?.length ?? 0) > 0)
		throw itemSourceError(
			"query_unsupported",
			"The local item source does not search or filter yet.",
		);
	const workspace = requiredWorkspace(deps, workspaceId);
	const collection =
		workspace.representationSchema.collections[query.collectionId];
	if (!collection)
		throw itemSourceError(
			"query_unsupported",
			`Collection "${query.collectionId}" not found in Structured Workspace "${workspace.name}".`,
		);
	const reads = bindingReads(deps, workspace, {
		collectionId: query.collectionId,
		collection,
		pointers: [
			collection.sortBy,
			collection.groupBy,
			query.sort?.field,
			query.groupBy,
		],
	});
	const listed = deps.store
		.loadStructuredWorkspaceCollectionItems(workspace.id, query.collectionId)
		.map((row) => listedItem(row, reads));
	const ordered = orderedItems(listed, query, collection);
	return {
		...pageOf(ordered.items, query),
		total: listed.length,
		...(ordered.groups ? { groups: ordered.groups } : {}),
	};
}

function listedItem(
	row: StoredStructuredWorkspaceItem,
	reads: ReadonlyMap<string, BindingRead>,
): ListedItem {
	const read = reads.get(row.bindingId);
	const data = row.data ?? {};
	const issues =
		row.data === null
			? [missingData]
			: read
				? structuredWorkspaceItemDataIssues(read.schema, data)
				: [];
	return {
		summary: {
			id: row.id,
			revision: String(row.revision),
			bindingId: row.bindingId,
			fields: read ? summaryFields(data, read.rule) : data,
			...(issues.length > 0 ? { issues } : {}),
		},
		data,
	};
}

/** The summary field rule and the validating schema of each binding of a
 * collection. */
function bindingReads(
	deps: Pick<LocalItemSourceDeps, "documents">,
	workspace: StructuredWorkspaceDefinition,
	target: {
		collectionId: string;
		collection: StructuredWorkspaceCollectionRepresentation;
		pointers: Array<string | undefined>;
	},
): Map<string, BindingRead> {
	const { collection } = target;
	const indexPages = [
		...(deps.documents.resolveById(collection.collectionTemplateDocumentId)
			?.pages ?? []),
		...collectionDocumentPages(deps, workspace.id, target.collectionId),
	];
	return new Map(
		Object.entries(collection.bindings).map(([bindingId, binding]) => {
			const schema = bindingSchemaOrRoot(workspace, binding);
			const rule = summaryFieldRule({
				bindingSchema: schema,
				compactPages: binding.compactTemplateDocumentId
					? (deps.documents.resolveById(binding.compactTemplateDocumentId)
							?.pages ?? [])
					: [],
				indexPages,
				pointers: target.pointers,
			});
			return [bindingId, { rule, schema }];
		}),
	);
}

function bindingSchemaOrRoot(
	workspace: StructuredWorkspaceDefinition,
	binding: StructuredWorkspaceCollectionRepresentation["bindings"][string],
) {
	try {
		return structuredWorkspaceBindingSchema(workspace.dataSchema, binding);
	} catch {
		return workspace.dataSchema;
	}
}

function collectionDocumentPages(
	deps: Pick<LocalItemSourceDeps, "documents">,
	workspaceId: string,
	collectionId: string,
) {
	for (const document of deps.documents.all().values()) {
		const owner = document.meta.structuredWorkspace;
		if (
			owner?.role === "collection" &&
			owner.workspaceId === workspaceId &&
			owner.collectionId === collectionId
		)
			return document.pages;
	}
	return [];
}

function orderedItems(
	listed: ListedItem[],
	query: ItemQuery,
	collection: StructuredWorkspaceCollectionRepresentation,
): { items: ListedItem[]; groups?: ItemPage["groups"] } {
	const dataOf = (item: ListedItem) => item.data;
	const sort = query.sort
		? { sortBy: query.sort.field, sortDirection: query.sort.direction }
		: {};
	if (query.groupBy === undefined)
		return { items: sortItems(listed, dataOf, sort) };
	const groups = groupItems(listed, dataOf, {
		groupBy: query.groupBy,
		groupOrder:
			query.groupBy === collection.groupBy ? (collection.groupOrder ?? []) : [],
	});
	return {
		items: groups.flatMap((group) => sortItems(group.entries, dataOf, sort)),
		groups: groups.map((group) => ({
			value: groupValue(group.value),
			count: group.entries.length,
		})),
	};
}

function groupValue(value: unknown): StructuredWorkspaceGroupValue {
	return value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
		? value
		: JSON.stringify(value);
}

function pageOf(
	items: ListedItem[],
	query: Pick<ItemQuery, "cursor" | "limit">,
): Pick<ItemPage, "items" | "cursor"> {
	const offset = cursorOffset(query.cursor);
	if (!(query.limit >= 0))
		throw itemSourceError(
			"query_unsupported",
			`Page limit ${query.limit} is not a count of items.`,
		);
	const end = offset + query.limit;
	return {
		items: items.slice(offset, end).map((item) => item.summary),
		cursor: {
			offset,
			...(end < items.length ? { next: String(end) } : {}),
			...(offset > 0
				? { previous: String(Math.max(0, offset - query.limit)) }
				: {}),
		},
	};
}

function cursorOffset(cursor: string | undefined): number {
	if (cursor === undefined) return 0;
	if (!/^\d+$/.test(cursor))
		throw itemSourceError(
			"query_unsupported",
			`Cursor "${cursor}" was not issued by the local item source.`,
		);
	return Number(cursor);
}

function requiredWorkspace(
	deps: Pick<LocalItemSourceDeps, "store">,
	workspaceId: string,
): StructuredWorkspaceDefinition {
	const workspace = deps.store.loadStructuredWorkspace(workspaceId);
	if (!workspace)
		throw itemSourceError(
			"source_unreachable",
			`Structured Workspace "${workspaceId}" not found.`,
		);
	return workspace;
}

function existingRow(
	deps: LocalItemSourceDeps,
	target: { workspaceId: string; id: string },
): StoredStructuredWorkspaceItem {
	const row = deps.store.loadStructuredWorkspaceItem(
		target.workspaceId,
		target.id,
	);
	if (!row)
		throw itemSourceError(
			"unknown_item",
			`Item "${target.id}" not found in Structured Workspace "${target.workspaceId}".`,
		);
	return row;
}

function staleRevision(
	row: StoredStructuredWorkspaceItem,
	expectedRevision: string,
) {
	return itemSourceError(
		"stale_revision",
		`Item "${row.id}" is at revision ${row.revision}, not ${expectedRevision}.`,
		{ currentRevision: String(row.revision) },
	);
}

function createItem(
	deps: LocalItemSourceDeps,
	workspaceId: string,
	input: ItemCreation,
): ItemRecord {
	const workspace = requiredWorkspace(deps, workspaceId);
	const id = input.id ?? crypto.randomUUID();
	if (!input.document)
		throw itemSourceError(
			"invalid_record",
			`Item "${id}" needs the document that renders it.`,
		);
	if (deps.store.loadStructuredWorkspaceItem(workspace.id, id))
		throw itemSourceError(
			"invalid_record",
			`Item "${id}" already exists in "${workspace.name}".`,
		);
	return writtenRecord(
		deps.store.addStructuredWorkspaceItem(workspace.id, {
			id,
			collectionId: input.collectionId,
			bindingId: input.bindingId,
			documentId: input.document.id,
			documentName: input.document.name,
			data: input.data,
		}),
	);
}

function putItem(
	deps: LocalItemSourceDeps,
	target: { workspaceId: string; id: string },
	change: { data: Record<string, unknown>; expectedRevision: string },
): ItemRecord {
	const expected = Number(change.expectedRevision);
	const write = deps.store.putStructuredWorkspaceItem(
		target.workspaceId,
		target.id,
		Number.isInteger(expected) ? expected : -1,
		change.data,
	);
	if (write.written) return writtenRecord(write.item);
	if (!write.current) return writtenRecord(existingRow(deps, target));
	throw staleRevision(write.current, change.expectedRevision);
}

function removeItem(
	deps: LocalItemSourceDeps,
	target: { workspaceId: string; id: string },
	expectedRevision: string | undefined,
): void {
	const row = existingRow(deps, target);
	if (
		expectedRevision !== undefined &&
		String(row.revision) !== expectedRevision
	)
		throw staleRevision(row, expectedRevision);
	if (
		!deps.store.deleteStructuredWorkspaceItem(
			target.workspaceId,
			target.id,
			expectedRevision === undefined ? undefined : row.revision,
		)
	)
		throw staleRevision(
			existingRow(deps, target),
			expectedRevision ?? String(row.revision),
		);
}
