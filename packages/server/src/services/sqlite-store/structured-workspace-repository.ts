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
	"position" | "revision" | "data"
> & { data: Record<string, unknown>; revision?: number };

/** A write at an expected revision: the written item, or the current one
 * (null when the item is gone) when the revision did not match. */
export type StructuredWorkspaceItemWrite =
	| { written: true; item: StoredStructuredWorkspaceItem }
	| { written: false; current: StoredStructuredWorkspaceItem | null };

export interface StructuredWorkspaceRepository {
	createStructuredWorkspace(
		workspace: NewStructuredWorkspace,
	): StructuredWorkspaceDefinition;
	loadStructuredWorkspace(name: string): StructuredWorkspaceDefinition | null;
	loadAllStructuredWorkspaces(): StructuredWorkspaceDefinition[];
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
	/** Insert an item last in its collection, at the position after the
	 * highest one, at revision 1 unless given. Positions are never renumbered:
	 * they stay sparse and increasing, so a cursor keyed on them stays valid. */
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
	 * other positions as they are; false when no row matched. */
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
	position: number;
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
	itemSelectByWorkspace: StatementSync;
	itemSelectOne: StatementSync;
	itemSelectByDocumentName: StatementSync;
	itemNextPosition: StatementSync;
	itemUpdate: StatementSync;
	itemDelete: StatementSync;
};

export function createStructuredWorkspaceRepository(
	db: DatabaseSync,
): StructuredWorkspaceRepository {
	db.function(sortTextFunction, { deterministic: true }, (value) =>
		value === null ? null : sortText(value),
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
			const position = nextPosition(statements, workspaceId, item.collectionId);
			statements.itemInsert.run({
				workspace_id: workspaceId,
				id: item.id,
				position,
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
				(workspace_id, id, position, collection_id, binding_id, document_id,
				 document_name, data, revision)
			VALUES
				($workspace_id, $id, $position, $collection_id, $binding_id, $document_id,
				 $document_name, $data, $revision)
		`),
		itemSelectByWorkspace: db.prepare(
			"SELECT id, position, collection_id, binding_id, document_id, document_name FROM structured_workspace_items WHERE workspace_id = ? ORDER BY collection_id ASC, position ASC",
		),
		itemSelectOne: db.prepare(
			"SELECT id, position, collection_id, binding_id, document_id, document_name, data, revision FROM structured_workspace_items WHERE workspace_id = ? AND id = ?",
		),
		itemSelectByDocumentName: db.prepare(
			"SELECT workspace_id, id, position, collection_id, binding_id, document_id, document_name, data, revision FROM structured_workspace_items WHERE document_name = ? LIMIT 1",
		),
		itemNextPosition: db.prepare(
			"SELECT coalesce(max(position), -1) + 1 AS position FROM structured_workspace_items WHERE workspace_id = ? AND collection_id = ?",
		),
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
	const items = statements.itemSelectByWorkspace.all(
		row.id,
	) as unknown as ItemRow[];
	return {
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		dataSchema: JSON.parse(row.data_schema),
		representationSchema: JSON.parse(row.representation_schema),
		revision: row.revision,
		items: items.map(itemFromRow),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function itemFromRow(row: ItemRow): StructuredWorkspaceItemReference {
	return {
		id: row.id,
		position: row.position,
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

function nextPosition(
	statements: Statements,
	workspaceId: string,
	collectionId: string,
): number {
	const row = statements.itemNextPosition.get(workspaceId, collectionId) as
		| { position: number }
		| undefined;
	return Number(row?.position ?? 0);
}
