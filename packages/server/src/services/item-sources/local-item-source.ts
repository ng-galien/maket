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
	structuredWorkspaceMaxBatch,
	structuredWorkspaceSchemaDeclaresPath,
	structuredWorkspaceTemplateFields,
} from "@maket/shared";
import type { Bus } from "../bus.js";
import type { Documents } from "../documents.js";
import type {
	StoredItemKey,
	StoredItemQueryRow,
} from "../sqlite-store/structured-workspace-item-query.js";
import type {
	StoredStructuredWorkspaceItem,
	StructuredWorkspaceRepository,
} from "../sqlite-store/structured-workspace-repository.js";
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
	search: true,
	sort: "pushdown",
	total: "exact",
	changes: "poll",
	revisions: "local",
};

/** How the items of one binding are summarized and validated. */
interface BindingRead {
	rule: SummaryFieldRule;
	schema: StructuredWorkspaceDataSchema;
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
	const workspace = requiredWorkspace(deps, workspaceId);
	const collection =
		workspace.representationSchema.collections[query.collectionId];
	if (!collection)
		throw itemSourceError(
			"unknown_collection",
			`Collection "${query.collectionId}" not found in Structured Workspace "${workspace.name}".`,
		);
	if (!Number.isInteger(query.limit) || query.limit < 1)
		throw itemSourceError(
			"query_unsupported",
			`Batch size ${query.limit} is not a count of items.`,
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
	assertDeclaredFields(workspace, collection, [
		...(query.filters ?? []).map((filter) => filter.field),
		...(query.sort ? [query.sort.field] : []),
	]);
	const signature = querySignature(query);
	const text = query.text?.trim();
	const result = deps.store.loadStructuredWorkspaceItemBatch({
		workspaceId: workspace.id,
		collectionId: query.collectionId,
		...(text
			? { text: { value: text, paths: searchPaths(workspace, collection) } }
			: {}),
		filters: (query.filters ?? []).map((filter) => ({
			path: filter.field,
			values: Array.isArray(filter.value) ? filter.value : [filter.value],
		})),
		...(query.sort
			? { sort: { path: query.sort.field, direction: query.sort.direction } }
			: {}),
		...(query.groupBy === undefined
			? {}
			: {
					group: {
						path: query.groupBy,
						order:
							query.groupBy === collection.groupBy
								? (collection.groupOrder ?? [])
								: [],
					},
				}),
		...(query.cursor === undefined
			? {}
			: { after: cursorKey(query.cursor, signature) }),
		limit: Math.min(query.limit, structuredWorkspaceMaxBatch) + 1,
	});
	const batch = result.rows.slice(
		0,
		Math.min(query.limit, structuredWorkspaceMaxBatch),
	);
	const last = batch.at(-1);
	return {
		items: batch.map((row) => listedSummary(row, reads, query.whole === true)),
		...(result.rows.length > batch.length && last
			? { next: encodeCursor(signature, last.key) }
			: {}),
		total: result.total,
		...(result.groups
			? {
					groups: result.groups.map((group) => ({
						value: groupValue(JSON.parse(group.key)),
						count: group.count,
					})),
				}
			: {}),
	};
}

function listedSummary(
	row: StoredItemQueryRow,
	reads: ReadonlyMap<string, BindingRead>,
	whole: boolean,
): ItemSummary {
	const read = reads.get(row.bindingId);
	const data = row.data ?? {};
	const issues =
		row.data === null
			? [missingData]
			: read
				? structuredWorkspaceItemDataIssues(read.schema, data)
				: [];
	return {
		id: row.id,
		revision: String(row.revision),
		bindingId: row.bindingId,
		documentName: row.documentName,
		fields: read && !whole ? summaryFields(data, read.rule) : data,
		...(issues.length > 0 ? { issues } : {}),
	};
}

/** Refuse a filter or sort field that no binding schema of the collection
 * declares, naming the declared properties. */
function assertDeclaredFields(
	workspace: StructuredWorkspaceDefinition,
	collection: StructuredWorkspaceCollectionRepresentation,
	fields: string[],
): void {
	const schemas = [
		workspace.dataSchema,
		...Object.values(collection.bindings).map((binding) =>
			bindingSchemaOrRoot(workspace, binding),
		),
	];
	for (const field of fields) {
		if (
			field.startsWith("/") &&
			field.length > 1 &&
			schemas.some((schema) =>
				structuredWorkspaceSchemaDeclaresPath(schema, field),
			)
		)
			continue;
		const declared = [
			...new Set(
				schemas.flatMap((schema) =>
					structuredWorkspaceTemplateFields(schema).map(
						(property) => `/${property.name}`,
					),
				),
			),
		];
		throw itemSourceError(
			"query_unsupported",
			`Field ${JSON.stringify(field)} is not a declared property of the items; declared: ${declared.join(", ") || "none"}.`,
		);
	}
}

/** The pointers a text query searches: the collection searchFields, else
 * every string property at depth one of its binding schemas. */
function searchPaths(
	workspace: StructuredWorkspaceDefinition,
	collection: StructuredWorkspaceCollectionRepresentation,
): string[] {
	if (collection.searchFields) return collection.searchFields;
	const names = new Set<string>();
	for (const binding of Object.values(collection.bindings)) {
		const properties = bindingSchemaOrRoot(workspace, binding).properties;
		if (!properties || typeof properties !== "object") continue;
		for (const [name, property] of Object.entries(properties)) {
			const type = (property as { type?: unknown } | null)?.type;
			if (type === "string" || (Array.isArray(type) && type.includes("string")))
				names.add(name);
		}
	}
	return [...names].map(
		(name) => `/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
	);
}

/** What makes two queries the same listing: a cursor of one is refused by
 * the other. */
function querySignature(query: ItemQuery): string {
	return crypto
		.createHash("sha1")
		.update(
			JSON.stringify([
				query.collectionId,
				query.text?.trim() ?? "",
				query.filters ?? [],
				query.sort ?? null,
				query.groupBy ?? null,
			]),
		)
		.digest("hex")
		.slice(0, 12);
}

function encodeCursor(signature: string, key: StoredItemKey): string {
	return Buffer.from(JSON.stringify({ q: signature, k: key })).toString(
		"base64url",
	);
}

function cursorKey(cursor: string, signature: string): StoredItemKey {
	try {
		const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
		if (decoded?.q === signature && typeof decoded.k?.id === "string")
			return decoded.k as StoredItemKey;
	} catch {}
	throw itemSourceError(
		"query_unsupported",
		`Cursor "${cursor}" was not issued by this query of the local item source; start the query again without a cursor.`,
	);
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

function groupValue(value: unknown): StructuredWorkspaceGroupValue {
	return value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
		? value
		: JSON.stringify(value);
}

function requiredWorkspace(
	deps: Pick<LocalItemSourceDeps, "store">,
	workspaceId: string,
): StructuredWorkspaceDefinition {
	const workspace = deps.store.loadStructuredWorkspace(workspaceId);
	if (!workspace)
		throw itemSourceError(
			"unknown_workspace",
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
	const { id } = input;
	if (!input.document)
		throw itemSourceError(
			"invalid_record",
			`Item "${id}" needs the document that renders it.`,
		);
	const existing = deps.store.loadStructuredWorkspaceItem(workspace.id, id);
	if (existing)
		throw itemSourceError(
			"invalid_record",
			`Item "${id}" already exists in collection "${existing.collectionId}" of "${workspace.name}" (document "${existing.documentName}"): an identity value is unique across the whole Workspace.`,
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
