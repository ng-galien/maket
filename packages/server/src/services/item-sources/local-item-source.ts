/**
 * The local connector: items stored by Maket itself, one state-backed
 * document per item, listed by the Structured Workspace repository. Reads
 * come from the item documents' current state; writes go through the
 * Structured Workspaces item mutations, which keep their validation, lock
 * guards and bus events.
 */

import crypto from "node:crypto";
import {
	type StructuredWorkspaceCollectionRepresentation,
	type StructuredWorkspaceDataSchema,
	type StructuredWorkspaceDefinition,
	type StructuredWorkspaceGroupValue,
	type StructuredWorkspaceItemReference,
	type StructuredWorkspaceItemView,
	structuredWorkspaceBindingSchema,
	structuredWorkspaceItemDataIssues,
} from "@maket/shared";
import { localizedOf } from "../../lib/message-error.js";
import type { Bus } from "../bus.js";
import type { DocumentStates } from "../document-states.js";
import type { Documents } from "../documents.js";
import type { StructuredWorkspaceRepository } from "../sqlite-store/structured-workspace-repository.js";
import type { StructuredWorkspaces } from "../structured-workspaces.js";
import { groupItems, sortItems } from "./item-order.js";
import type {
	ItemCreation,
	ItemPage,
	ItemQuery,
	ItemRecord,
	ItemSource,
	ItemSourceCapabilities,
	ItemSourceError,
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
	documents: Documents;
	documentStates: DocumentStates;
	store: StructuredWorkspaceRepository;
	/** Read at write time only, so the engine and its sources resolve each other. */
	structuredWorkspaces: Pick<
		StructuredWorkspaces,
		"addItem" | "updateItem" | "deleteItem"
	>;
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
			return row ? itemRecord(deps, row) : null;
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

/** The current data of one stored item, read from its document's state. */
function itemRecord(
	deps: Pick<LocalItemSourceDeps, "documents" | "documentStates">,
	row: StructuredWorkspaceItemReference,
): ItemRecord {
	const document = deps.documents.resolveById(row.documentId);
	if (!document)
		throw itemSourceError(
			"invalid_record",
			"Structured Workspace instantiated document not found.",
		);
	const current = deps.documentStates.current(document.name);
	if (!current)
		throw itemSourceError(
			"invalid_record",
			`Document "${document.name}" has no item data.`,
		);
	return {
		id: row.id,
		revision: String(current.revision),
		bindingId: row.bindingId,
		data: current.data,
	};
}

function recordOf(item: StructuredWorkspaceItemView): ItemRecord {
	return {
		id: item.id,
		revision: String(item.dataRevision),
		bindingId: item.bindingId,
		data: item.data,
	};
}

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
	const listed = workspace.items
		.filter((row) => row.collectionId === query.collectionId)
		.sort((left, right) => left.position - right.position)
		.map((row) => listedItem(deps, row, reads));
	const ordered = orderedItems(listed, query, collection);
	return {
		...pageOf(ordered.items, query),
		total: listed.length,
		...(ordered.groups ? { groups: ordered.groups } : {}),
	};
}

function listedItem(
	deps: LocalItemSourceDeps,
	row: StructuredWorkspaceItemReference,
	reads: ReadonlyMap<string, BindingRead>,
): ListedItem {
	const record = itemRecord(deps, row);
	const read = reads.get(row.bindingId);
	const issues = read
		? structuredWorkspaceItemDataIssues(read.schema, record.data)
		: [];
	return {
		summary: {
			id: record.id,
			revision: record.revision,
			bindingId: record.bindingId,
			fields: read ? summaryFields(record.data, read.rule) : record.data,
			...(issues.length > 0 ? { issues } : {}),
		},
		data: record.data,
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

function existingRecord(
	deps: LocalItemSourceDeps,
	target: { workspaceId: string; id: string },
): ItemRecord {
	const row = deps.store.loadStructuredWorkspaceItem(
		target.workspaceId,
		target.id,
	);
	if (!row)
		throw itemSourceError(
			"unknown_item",
			`Item "${target.id}" not found in Structured Workspace "${target.workspaceId}".`,
		);
	return itemRecord(deps, row);
}

function assertRevision(record: ItemRecord, expectedRevision: string): void {
	if (record.revision === expectedRevision) return;
	throw itemSourceError(
		"stale_revision",
		`Item "${record.id}" is at revision ${record.revision}, not ${expectedRevision}.`,
		{ currentRevision: record.revision },
	);
}

function createItem(
	deps: LocalItemSourceDeps,
	workspaceId: string,
	input: ItemCreation,
): ItemRecord {
	const workspace = requiredWorkspace(deps, workspaceId);
	const id = input.id ?? crypto.randomUUID();
	const collectionName =
		workspace.representationSchema.collections[input.collectionId]?.name ??
		input.collectionId;
	return translatedRefusals(() =>
		recordOf(
			deps.structuredWorkspaces.addItem({
				workspace: workspace.id,
				itemId: id,
				collectionId: input.collectionId,
				bindingId: input.bindingId,
				documentName: `${workspace.name} — ${collectionName} — ${id}`,
				data: input.data,
			}),
		),
	);
}

function putItem(
	deps: LocalItemSourceDeps,
	target: { workspaceId: string; id: string },
	change: { data: Record<string, unknown>; expectedRevision: string },
): ItemRecord {
	existingRecord(deps, target);
	return translatedRefusals(() =>
		recordOf(
			deps.structuredWorkspaces.updateItem(
				target.workspaceId,
				target.id,
				Number(change.expectedRevision),
				change.data,
			),
		),
	);
}

function removeItem(
	deps: LocalItemSourceDeps,
	target: { workspaceId: string; id: string },
	expectedRevision: string | undefined,
): void {
	const current = existingRecord(deps, target);
	if (expectedRevision !== undefined) assertRevision(current, expectedRevision);
	translatedRefusals(() =>
		deps.structuredWorkspaces.deleteItem(target.workspaceId, target.id),
	);
}

const invalidDataRefusal = /^Item data breaks the schema/;
const duplicateRefusal = /^(Item|Document) ".*" already exists/;
const revisionConflict = /revision conflict: expected .*, current (\d+)\./;

/** Runs a Structured Workspaces mutation and gives its refusals the item
 * source code they stand for, keeping their message. */
function translatedRefusals<T>(mutation: () => T): T {
	try {
		return mutation();
	} catch (error) {
		throw refusalOf(error);
	}
}

function refusalOf(error: unknown): unknown {
	if (!(error instanceof Error)) return error;
	const key = localizedOf(error)?.key;
	const conflict = revisionConflict.exec(error.message);
	const code: ItemSourceError["code"] | null =
		key === "msg_document_locked"
			? "read_only"
			: key === "msg_state_invalid" ||
					invalidDataRefusal.test(error.message) ||
					duplicateRefusal.test(error.message)
				? "invalid_record"
				: conflict
					? "stale_revision"
					: null;
	if (!code) return error;
	return itemSourceError(
		code,
		error.message,
		conflict?.[1] ? { currentRevision: conflict[1] } : {},
	);
}
