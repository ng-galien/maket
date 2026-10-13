import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
	StructuredWorkspaceDataSchema,
	StructuredWorkspaceDefinition,
	StructuredWorkspaceItemReference,
	StructuredWorkspaceRepresentationSchema,
} from "@maket/shared";
import {
	queryStoredItems,
	type StoredItemQuery,
	type StoredItemQueryResult,
	searchText,
	searchTextFunction,
	sortText,
	sortTextFunction,
} from "./structured-workspace-item-query.js";

export interface NewStructuredWorkspace {
	id: string;
	name: string;
	description?: string;
	dataSchema: StructuredWorkspaceDataSchema;
	representationSchema: StructuredWorkspaceRepresentationSchema;
}

/** One stored item: its row, its whole data and the revision a write must
 * expect. Data is null for a row migrated without a document state. */
export interface StoredStructuredWorkspaceItem
	extends StructuredWorkspaceItemReference {
	data: Record<string, unknown> | null;
	revision: number;
}

export type NewStructuredWorkspaceItem = Omit<
	StoredStructuredWorkspaceItem,
	"sequence" | "revision" | "data"
> & { data: Record<string, unknown>; revision?: number };

/** An item whose document exists, with what that document says of itself. */
export interface OpenedStructuredWorkspaceItem
	extends StructuredWorkspaceItemReference {
	pinnedAt: string | null;
	locked: boolean;
	/** The workspace and item the document's own meta names. */
	owner: { workspaceId: string | null; itemId: string | null };
}

/** An item whose reserved document name another document bears. */
export interface StructuredWorkspaceItemNameConflict {
	item: StructuredWorkspaceItemReference;
	holder: string;
}

/** A write at an expected revision: the written item, or the current one
 * (null when the item is gone) when the revision did not match. */
export type StructuredWorkspaceItemWrite =
	| { written: true; item: StoredStructuredWorkspaceItem }
	| { written: false; current: StoredStructuredWorkspaceItem | null };

export interface StructuredWorkspaceRepository {
	createStructuredWorkspace(
		workspace: NewStructuredWorkspace,
	): StructuredWorkspaceDefinition;
	/** The definition with its item count per collection; no item row. */
	loadStructuredWorkspace(name: string): StructuredWorkspaceDefinition | null;
	loadAllStructuredWorkspaces(): StructuredWorkspaceDefinition[];
	/** The items of a workspace whose document exists. */
	loadOpenedStructuredWorkspaceItems(
		workspaceId: string,
	): OpenedStructuredWorkspaceItem[];
	/** The items of a workspace whose document name another document bears. */
	loadStructuredWorkspaceItemNameConflicts(
		workspaceId: string,
	): StructuredWorkspaceItemNameConflict[];
	/** The name of a locked document the workspace owns, or null. */
	loadLockedStructuredWorkspaceDocument(workspaceId: string): string | null;
	/** One item row of a workspace with its data, or null when the workspace
	 * has no such item. */
	loadStructuredWorkspaceItem(
		workspaceId: string,
		itemId: string,
	): StoredStructuredWorkspaceItem | null;
	/** One batch of the items of a collection matching `query`, in index
	 * order after `query.after`, with the total and the group counts. */
	loadStructuredWorkspaceItemBatch(
		query: StoredItemQuery,
	): StoredItemQueryResult;
	/** The item whose document bears `documentName`, in any workspace. */
	loadStructuredWorkspaceItemByDocumentName(
		documentName: string,
	): { workspaceId: string; item: StoredStructuredWorkspaceItem } | null;
	renameStructuredWorkspace(
		workspaceId: string,
		newName: string,
		expectedRevision: number,
		documentRenames: Array<{ id: string; newName: string }>,
	): {
		workspace: StructuredWorkspaceDefinition;
		renamedDocuments: Array<{ id: string; oldName: string; newName: string }>;
	};
	deleteStructuredWorkspaceCascade(
		workspaceId: string,
	): Array<{ id: string; name: string }>;
	updateStructuredWorkspace(
		name: string,
		expectedRevision: number,
		dataSchema: StructuredWorkspaceDataSchema,
		representationSchema: StructuredWorkspaceRepresentationSchema,
	): StructuredWorkspaceDefinition;
	/** Insert an item last in its collection under the next value of the
	 * collection's sequence counter, at revision 1 unless given. A sequence is
	 * never given twice, even after deletes, so a cursor keyed on it stays
	 * valid. */
	addStructuredWorkspaceItem(
		workspaceId: string,
		item: NewStructuredWorkspaceItem,
	): StoredStructuredWorkspaceItem;
	/** Replace an item's data when its revision is `expectedRevision`. */
	putStructuredWorkspaceItem(
		workspaceId: string,
		itemId: string,
		expectedRevision: number,
		data: Record<string, unknown>,
	): StructuredWorkspaceItemWrite;
	/** Delete an item, only at `expectedRevision` when given, leaving the
	 * other sequences as they are; false when no row matched. */
	deleteStructuredWorkspaceItem(
		workspaceId: string,
		itemId: string,
		expectedRevision?: number,
	): boolean;
}

interface WorkspaceRow {
	id: string;
	name: string;
	description: string | null;
	data_schema: string;
	representation_schema: string;
	revision: number;
	created_at: string;
	updated_at: string;
}

interface ItemRow {
	id: string;
	sequence: number;
	collection_id: string;
	binding_id: string;
	document_id: string;
	document_name: string;
}

interface StoredItemRow extends ItemRow {
	data: string | null;
	revision: number;
}

type Statements = {
	workspaceInsert: StatementSync;
	workspaceSelectOne: StatementSync;
	workspaceSelectAll: StatementSync;
	workspaceUpdate: StatementSync;
	workspaceRename: StatementSync;
	workspaceDelete: StatementSync;
	ownedDocumentsSelect: StatementSync;
	ownedDocumentsMove: StatementSync;
	ownedDocumentsDelete: StatementSync;
	documentSelectById: StatementSync;
	documentSelectByName: StatementSync;
	documentRenameById: StatementSync;
	pageRenameDocument: StatementSync;
	itemInsert: StatementSync;
	itemCounts: StatementSync;
	itemsOpened: StatementSync;
	itemNameConflicts: StatementSync;
	lockedDocument: StatementSync;
	itemSelectOne: StatementSync;
	itemSelectByDocumentName: StatementSync;
	itemNextSequence: StatementSync;
	itemUpdate: StatementSync;
	itemDelete: StatementSync;
};

export function createStructuredWorkspaceRepository(
	db: DatabaseSync,
): StructuredWorkspaceRepository {
	db.function(sortTextFunction, { deterministic: true }, (value) =>
		value === null ? null : sortText(value),
	);
	db.function(searchTextFunction, { deterministic: true }, (value) =>
		value === null ? null : searchText(value),
	);
	const statements = prepareStatements(db);
	return {
		createStructuredWorkspace(workspace) {
			statements.workspaceInsert.run({
				id: workspace.id,
				name: workspace.name,
				description: workspace.description ?? null,
				data_schema: JSON.stringify(workspace.dataSchema),
				representation_schema: JSON.stringify(workspace.representationSchema),
			});
			return requiredWorkspace(statements, workspace.name);
		},
		loadStructuredWorkspace(reference) {
			const row = statements.workspaceSelectOne.get(reference, reference) as
				| WorkspaceRow
				| undefined;
			return row ? workspaceFromRow(statements, row) : null;
		},
		loadAllStructuredWorkspaces() {
			return (
				statements.workspaceSelectAll.all() as unknown as WorkspaceRow[]
			).map((row) => workspaceFromRow(statements, row));
		},
		loadOpenedStructuredWorkspaceItems(workspaceId) {
			return (
				statements.itemsOpened.all(workspaceId) as unknown as Array<
					ItemRow & {
						pinned_at: string | null;
						locked: number | null;
						owner_workspace: string | null;
						owner_item: string | null;
					}
				>
			).map((row) => ({
				...itemFromRow(row),
				pinnedAt: row.pinned_at,
				locked: row.locked === 1,
				owner: { workspaceId: row.owner_workspace, itemId: row.owner_item },
			}));
		},
		loadStructuredWorkspaceItemNameConflicts(workspaceId) {
			return (
				statements.itemNameConflicts.all(workspaceId) as unknown as Array<
					ItemRow & { holder: string }
				>
			).map((row) => ({ item: itemFromRow(row), holder: row.holder }));
		},
		loadLockedStructuredWorkspaceDocument(workspaceId) {
			const row = statements.lockedDocument.get(workspaceId) as
				| { name: string }
				| undefined;
			return row?.name ?? null;
		},
		loadStructuredWorkspaceItem(workspaceId, itemId) {
			const row = statements.itemSelectOne.get(workspaceId, itemId) as
				| StoredItemRow
				| undefined;
			return row ? storedItemFromRow(row) : null;
		},
		loadStructuredWorkspaceItemBatch(query) {
			return queryStoredItems(db, query);
		},
		loadStructuredWorkspaceItemByDocumentName(documentName) {
			const row = statements.itemSelectByDocumentName.get(documentName) as
				| (StoredItemRow & { workspace_id: string })
				| undefined;
			return row
				? { workspaceId: row.workspace_id, item: storedItemFromRow(row) }
				: null;
		},
		updateStructuredWorkspace(
			reference,
			expectedRevision,
			dataSchema,
			representationSchema,
		) {
			const current = statements.workspaceSelectOne.get(reference, reference) as
				| WorkspaceRow
				| undefined;
			if (!current)
				throw new Error(`Structured Workspace "${reference}" not found.`);
			const result = statements.workspaceUpdate.run({
				id: current.id,
				expected_revision: expectedRevision,
				data_schema: JSON.stringify(dataSchema),
				representation_schema: JSON.stringify(representationSchema),
			});
			if (result.changes === 0) {
				throw new Error(
					`Structured Workspace revision conflict: expected ${expectedRevision}, current ${current.revision}.`,
				);
			}
			return requiredWorkspace(statements, current.id);
		},
		renameStructuredWorkspace(
			workspaceId,
			newName,
			expectedRevision,
			documentRenames,
		) {
			return renameWorkspaceTransaction({
				db,
				statements,
				workspaceId,
				newName,
				expectedRevision,
				documentRenames,
			});
		},
		deleteStructuredWorkspaceCascade(workspaceId) {
			db.exec("SAVEPOINT maket_repository");
			try {
				const documents = statements.ownedDocumentsSelect.all(
					workspaceId,
				) as unknown as Array<{ id: string; name: string }>;
				statements.ownedDocumentsDelete.run(workspaceId);
				statements.workspaceDelete.run(workspaceId);
				db.exec("RELEASE maket_repository");
				return documents;
			} catch (error) {
				db.exec("ROLLBACK TO maket_repository; RELEASE maket_repository");
				throw error;
			}
		},
		addStructuredWorkspaceItem(workspaceId, item) {
			const sequence = nextSequence(statements, workspaceId, item.collectionId);
			statements.itemInsert.run({
				workspace_id: workspaceId,
				id: item.id,
				sequence,
				collection_id: item.collectionId,
				binding_id: item.bindingId,
				document_id: item.documentId,
				document_name: item.documentName,
				data: JSON.stringify(item.data),
				revision: item.revision ?? 1,
			});
			return requiredItem(statements, workspaceId, item.id);
		},
		putStructuredWorkspaceItem(workspaceId, itemId, expectedRevision, data) {
			const result = statements.itemUpdate.run({
				workspace_id: workspaceId,
				id: itemId,
				expected_revision: expectedRevision,
				data: JSON.stringify(data),
			});
			if (Number(result.changes) === 0) {
				const current = statements.itemSelectOne.get(workspaceId, itemId) as
					| StoredItemRow
					| undefined;
				return {
					written: false,
					current: current ? storedItemFromRow(current) : null,
				};
			}
			return {
				written: true,
				item: requiredItem(statements, workspaceId, itemId),
			};
		},
		deleteStructuredWorkspaceItem(workspaceId, itemId, expectedRevision) {
			return (
				statements.itemDelete.run({
					workspace_id: workspaceId,
					id: itemId,
					expected_revision: expectedRevision ?? null,
				}).changes > 0
			);
		},
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// The repository transaction coordinates the aggregate row, derived document
// names, page foreign keys, and owned category paths as one persistence unit.
function renameWorkspaceTransaction({
	db,
	statements,
	workspaceId,
	newName,
	expectedRevision,
	documentRenames,
}: {
	db: DatabaseSync;
	statements: Statements;
	workspaceId: string;
	newName: string;
	expectedRevision: number;
	documentRenames: Array<{ id: string; newName: string }>;
}): {
	workspace: StructuredWorkspaceDefinition;
	renamedDocuments: Array<{ id: string; oldName: string; newName: string }>;
} {
	db.exec("SAVEPOINT maket_repository");
	try {
		db.exec("PRAGMA defer_foreign_keys = ON");
		const renamedDocuments = documentRenames.map(({ id, newName }) => {
			const source = statements.documentSelectById.get(id) as
				| { id: string; name: string }
				| undefined;
			if (!source) throw new Error(`Workspace document "${id}" not found.`);
			const collision = statements.documentSelectByName.get(newName) as
				| { id: string; name: string }
				| undefined;
			if (collision && collision.id !== id) {
				throw new Error(`Document "${newName}" already exists.`);
			}
			return { id, oldName: source.name, newName };
		});
		const result = statements.workspaceRename.run({
			id: workspaceId,
			new_name: newName,
			expected_revision: expectedRevision,
		});
		if (result.changes === 0) {
			const current = statements.workspaceSelectOne.get(
				workspaceId,
				workspaceId,
			) as WorkspaceRow | undefined;
			if (!current)
				throw new Error(`Structured Workspace "${workspaceId}" not found.`);
			throw new Error(
				`Structured Workspace revision conflict: expected ${expectedRevision}, current ${current.revision}.`,
			);
		}
		statements.ownedDocumentsMove.run({
			workspace_id: workspaceId,
			category: `Structured Workspaces/${newName}`,
		});
		for (const document of renamedDocuments) {
			if (document.oldName === document.newName) continue;
			statements.documentRenameById.run({
				id: document.id,
				new_name: document.newName,
			});
			statements.pageRenameDocument.run({
				old_name: document.oldName,
				new_name: document.newName,
			});
		}
		db.exec("RELEASE maket_repository");
		return {
			workspace: requiredWorkspace(statements, workspaceId),
			renamedDocuments,
		};
	} catch (error) {
		db.exec("ROLLBACK TO maket_repository; RELEASE maket_repository");
		throw error;
	}
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Repository setup owns the prepared-statement catalog for this persistence adapter.
function prepareStatements(db: DatabaseSync): Statements {
	return {
		workspaceInsert: db.prepare(`
			INSERT INTO structured_workspaces
				(id, name, description, data_schema, representation_schema, revision)
			VALUES
				($id, $name, $description, $data_schema, $representation_schema, 1)
		`),
		workspaceSelectOne: db.prepare(
			"SELECT * FROM structured_workspaces WHERE id = ? OR name = ?",
		),
		workspaceSelectAll: db.prepare(
			"SELECT * FROM structured_workspaces ORDER BY updated_at ASC",
		),
		workspaceUpdate: db.prepare(`
			UPDATE structured_workspaces
			SET data_schema = $data_schema,
				representation_schema = $representation_schema,
				revision = revision + 1,
				updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
			WHERE id = $id AND revision = $expected_revision
		`),
		workspaceRename: db.prepare(`
			UPDATE structured_workspaces
			SET name = $new_name,
				revision = revision + 1,
				updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
			WHERE id = $id AND revision = $expected_revision
		`),
		workspaceDelete: db.prepare(
			"DELETE FROM structured_workspaces WHERE id = ?",
		),
		ownedDocumentsSelect: db.prepare(`
			SELECT id, name FROM documents
			WHERE json_extract(meta, '$.structuredWorkspace.workspaceId') = ?
		`),
		ownedDocumentsMove: db.prepare(`
			UPDATE documents SET category = $category
			WHERE json_extract(meta, '$.structuredWorkspace.workspaceId') = $workspace_id
		`),
		ownedDocumentsDelete: db.prepare(`
			DELETE FROM documents
			WHERE json_extract(meta, '$.structuredWorkspace.workspaceId') = ?
		`),
		documentSelectById: db.prepare(
			"SELECT id, name FROM documents WHERE id = ?",
		),
		documentSelectByName: db.prepare(
			"SELECT id, name FROM documents WHERE name = ?",
		),
		documentRenameById: db.prepare(
			"UPDATE documents SET name = $new_name WHERE id = $id",
		),
		pageRenameDocument: db.prepare(
			"UPDATE pages SET doc_name = $new_name WHERE doc_name = $old_name",
		),
		itemInsert: db.prepare(`
			INSERT INTO structured_workspace_items
				(workspace_id, id, sequence, collection_id, binding_id, document_id,
				 document_name, data, revision)
			VALUES
				($workspace_id, $id, $sequence, $collection_id, $binding_id, $document_id,
				 $document_name, $data, $revision)
		`),
		itemCounts: db.prepare(
			"SELECT collection_id, count(*) AS count FROM structured_workspace_items WHERE workspace_id = ? GROUP BY collection_id",
		),
		itemsOpened: db.prepare(`
			SELECT item.id, item.sequence, item.collection_id, item.binding_id,
				item.document_id, item.document_name, document.pinned_at,
				json_extract(document.meta, '$.locked') AS locked,
				json_extract(document.meta, '$.structuredWorkspace.workspaceId') AS owner_workspace,
				json_extract(document.meta, '$.structuredWorkspace.itemId') AS owner_item
			FROM structured_workspace_items AS item
			JOIN documents AS document ON document.id = item.document_id
			WHERE item.workspace_id = ?
			ORDER BY item.collection_id ASC, item.sequence ASC
		`),
		itemNameConflicts: db.prepare(`
			SELECT item.id, item.sequence, item.collection_id, item.binding_id,
				item.document_id, item.document_name, document.name AS holder
			FROM structured_workspace_items AS item
			JOIN documents AS document
				ON document.name = item.document_name AND document.id <> item.document_id
			WHERE item.workspace_id = ?
			ORDER BY item.collection_id ASC, item.sequence ASC
		`),
		lockedDocument: db.prepare(`
			SELECT name FROM documents
			WHERE json_extract(meta, '$.structuredWorkspace.workspaceId') = ?
				AND json_extract(meta, '$.locked') = 1
			LIMIT 1
		`),
		itemSelectOne: db.prepare(
			"SELECT id, sequence, collection_id, binding_id, document_id, document_name, data, revision FROM structured_workspace_items WHERE workspace_id = ? AND id = ?",
		),
		itemSelectByDocumentName: db.prepare(
			"SELECT workspace_id, id, sequence, collection_id, binding_id, document_id, document_name, data, revision FROM structured_workspace_items WHERE document_name = ? LIMIT 1",
		),
		itemNextSequence: db.prepare(`
			INSERT INTO structured_workspace_sequences (workspace_id, collection_id, last)
			VALUES (?, ?, 1)
			ON CONFLICT (workspace_id, collection_id) DO UPDATE SET last = last + 1
			RETURNING last
		`),
		itemUpdate: db.prepare(`
			UPDATE structured_workspace_items
			SET data = $data, revision = revision + 1
			WHERE workspace_id = $workspace_id AND id = $id AND revision = $expected_revision
		`),
		itemDelete: db.prepare(`
			DELETE FROM structured_workspace_items
			WHERE workspace_id = $workspace_id AND id = $id
				AND ($expected_revision IS NULL OR revision = $expected_revision)
		`),
	};
}

function requiredWorkspace(
	statements: Statements,
	name: string,
): StructuredWorkspaceDefinition {
	const row = statements.workspaceSelectOne.get(name, name) as
		| WorkspaceRow
		| undefined;
	if (!row)
		throw new Error(`Structured Workspace "${name}" was not persisted.`);
	return workspaceFromRow(statements, row);
}

function workspaceFromRow(
	statements: Statements,
	row: WorkspaceRow,
): StructuredWorkspaceDefinition {
	const representationSchema = JSON.parse(
		row.representation_schema,
	) as StructuredWorkspaceRepresentationSchema;
	const itemCounts: Record<string, number> = Object.fromEntries(
		Object.keys(representationSchema.collections ?? {}).map((id) => [id, 0]),
	);
	for (const count of statements.itemCounts.all(row.id) as Array<{
		collection_id: string;
		count: number;
	}>)
		itemCounts[count.collection_id] = Number(count.count);
	return {
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		dataSchema: JSON.parse(row.data_schema),
		representationSchema,
		revision: row.revision,
		itemCounts,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function itemFromRow(row: ItemRow): StructuredWorkspaceItemReference {
	return {
		id: row.id,
		sequence: Number(row.sequence),
		collectionId: row.collection_id,
		bindingId: row.binding_id,
		documentId: row.document_id,
		documentName: row.document_name,
	};
}

function storedItemFromRow(row: StoredItemRow): StoredStructuredWorkspaceItem {
	return {
		...itemFromRow(row),
		data: row.data === null ? null : JSON.parse(row.data),
		revision: Number(row.revision),
	};
}

function requiredItem(
	statements: Statements,
	workspaceId: string,
	itemId: string,
): StoredStructuredWorkspaceItem {
	const row = statements.itemSelectOne.get(workspaceId, itemId) as
		| StoredItemRow
		| undefined;
	if (!row) throw new Error(`Item "${itemId}" was not persisted.`);
	return storedItemFromRow(row);
}

/** The next value of a collection's sequence counter, which it consumes. */
function nextSequence(
	statements: Statements,
	workspaceId: string,
	collectionId: string,
): number {
	const row = statements.itemNextSequence.get(workspaceId, collectionId) as
		| { last: number }
		| undefined;
	if (!row) throw new Error(`No sequence for collection "${collectionId}".`);
	return Number(row.last);
}
