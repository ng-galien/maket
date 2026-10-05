import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
	StructuredWorkspaceDataSchema,
	StructuredWorkspaceDefinition,
	StructuredWorkspaceItemReference,
	StructuredWorkspaceRepresentationSchema,
} from "@maket/shared";

export interface NewStructuredWorkspace {
	id: string;
	name: string;
	description?: string;
	dataSchema: StructuredWorkspaceDataSchema;
	representationSchema: StructuredWorkspaceRepresentationSchema;
}

export interface StructuredWorkspaceRepository {
	createStructuredWorkspace(
		workspace: NewStructuredWorkspace,
	): StructuredWorkspaceDefinition;
	loadStructuredWorkspace(name: string): StructuredWorkspaceDefinition | null;
	loadAllStructuredWorkspaces(): StructuredWorkspaceDefinition[];
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
	addStructuredWorkspaceItem(
		workspaceId: string,
		item: Omit<StructuredWorkspaceItemReference, "position">,
	): StructuredWorkspaceItemReference;
	deleteStructuredWorkspaceItem(workspaceId: string, itemId: string): boolean;
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
	itemDelete: StatementSync;
	itemCompactPositions: StatementSync;
};

export function createStructuredWorkspaceRepository(
	db: DatabaseSync,
): StructuredWorkspaceRepository {
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
			});
			return { ...item, position };
		},
		deleteStructuredWorkspaceItem(workspaceId, itemId) {
			db.exec("SAVEPOINT maket_repository");
			try {
				const result = statements.itemDelete.run(workspaceId, itemId);
				statements.itemCompactPositions.run(workspaceId);
				db.exec("RELEASE maket_repository");
				return result.changes > 0;
			} catch (error) {
				db.exec("ROLLBACK TO maket_repository; RELEASE maket_repository");
				throw error;
			}
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
				(workspace_id, id, position, collection_id, binding_id, document_id)
			VALUES
				($workspace_id, $id, $position, $collection_id, $binding_id, $document_id)
		`),
		itemSelectByWorkspace: db.prepare(
			"SELECT id, position, collection_id, binding_id, document_id FROM structured_workspace_items WHERE workspace_id = ? ORDER BY collection_id ASC, position ASC",
		),
		itemDelete: db.prepare(
			"DELETE FROM structured_workspace_items WHERE workspace_id = ? AND id = ?",
		),
		itemCompactPositions: db.prepare(`
			UPDATE structured_workspace_items AS target
			SET position = (
				SELECT count(*)
				FROM structured_workspace_items AS preceding
				WHERE preceding.workspace_id = target.workspace_id
					AND preceding.collection_id = target.collection_id
					AND preceding.position < target.position
			)
			WHERE workspace_id = ?
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
		items: items.map((item) => ({
			id: item.id,
			position: item.position,
			collectionId: item.collection_id,
			bindingId: item.binding_id,
			documentId: item.document_id,
		})),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function nextPosition(
	statements: Statements,
	workspaceId: string,
	collectionId: string,
): number {
	const rows = statements.itemSelectByWorkspace.all(
		workspaceId,
	) as unknown as ItemRow[];
	return rows.filter((row) => row.collection_id === collectionId).length;
}
