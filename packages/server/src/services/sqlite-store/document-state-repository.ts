import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
	DocumentStateData,
	DocumentStateRevision,
	DocumentStateSchema,
} from "@maket/shared";
import { NEXT_DOCUMENT_UPDATED_AT_SQL } from "./document-timestamp.js";

export interface StoredDocumentState {
	documentId: string;
	schema: DocumentStateSchema;
	createdAt: string;
}

export interface DocumentStateRepository {
	initializeDocumentState(
		documentId: string,
		schema: DocumentStateSchema,
		data: DocumentStateData,
	): DocumentStateRevision;
	loadDocumentState(documentId: string): StoredDocumentState | null;
	loadCurrentDocumentState(documentId: string): DocumentStateRevision | null;
	loadDocumentStateRevision(
		documentId: string,
		revision: number,
	): DocumentStateRevision | null;
	loadDocumentStateHistory(documentId: string): DocumentStateRevision[];
	appendDocumentStateRevision(
		documentId: string,
		expectedRevision: number,
		data: DocumentStateData,
	): DocumentStateRevision;
	replaceDocumentStateSchema(
		documentId: string,
		expectedRevision: number,
		schema: DocumentStateSchema,
		data: DocumentStateData,
	): DocumentStateRevision;
}

export function createDocumentStateRepository(
	db: DatabaseSync,
): DocumentStateRepository {
	const statements = prepareStatements(db);

	return {
		initializeDocumentState(documentId, schema, data) {
			return initializeState(db, statements, documentId, schema, data);
		},
		loadDocumentState(documentId) {
			const row = statements.stateSelect.get(documentId);
			return row ? stateFromRow(row) : null;
		},
		loadCurrentDocumentState(documentId) {
			const row = statements.revisionSelectCurrent.get(documentId);
			return row ? revisionFromRow(row) : null;
		},
		loadDocumentStateRevision(documentId, revision) {
			const row = statements.revisionSelect.get(documentId, revision);
			return row ? revisionFromRow(row) : null;
		},
		loadDocumentStateHistory(documentId) {
			return statements.revisionSelectAll.all(documentId).map(revisionFromRow);
		},
		appendDocumentStateRevision(documentId, expectedRevision, data) {
			return appendRevision(db, statements, documentId, expectedRevision, data);
		},
		replaceDocumentStateSchema(documentId, expectedRevision, schema, data) {
			return replaceSchema(
				db,
				statements,
				documentId,
				expectedRevision,
				schema,
				data,
			);
		},
	};
}

type DocumentStateStatements = {
	stateInsert: StatementSync;
	stateSelect: StatementSync;
	stateUpdate: StatementSync;
	revisionInsert: StatementSync;
	revisionSelect: StatementSync;
	revisionSelectCurrent: StatementSync;
	revisionSelectAll: StatementSync;
	documentMarkState: StatementSync;
	documentTouch: StatementSync;
};

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// SQLite transaction adapter: statement fan-out is the repository boundary.
function initializeState(
	db: DatabaseSync,
	statements: DocumentStateStatements,
	documentId: string,
	schema: DocumentStateSchema,
	data: DocumentStateData,
): DocumentStateRevision {
	db.exec("BEGIN");
	try {
		statements.stateInsert.run({
			document_id: documentId,
			schema: JSON.stringify(schema),
		});
		statements.revisionInsert.run({
			document_id: documentId,
			revision: 1,
			schema: JSON.stringify(schema),
			data: JSON.stringify(data),
		});
		statements.documentMarkState.run({ document_id: documentId });
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
	return requiredRevision(statements.revisionSelect.get(documentId, 1));
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// SQLite transaction adapter: optimistic append must coordinate its statements.
function appendRevision(
	db: DatabaseSync,
	statements: DocumentStateStatements,
	documentId: string,
	expectedRevision: number,
	data: DocumentStateData,
): DocumentStateRevision {
	db.exec("BEGIN");
	try {
		const current = statements.revisionSelectCurrent.get(documentId);
		if (!current) {
			throw new Error(`Document state not found for id "${documentId}".`);
		}
		const currentSnapshot = revisionFromRow(current);
		const currentRevision = currentSnapshot.revision;
		if (currentRevision !== expectedRevision) {
			throw new Error(
				`Document state revision conflict: expected ${expectedRevision}, current ${currentRevision}.`,
			);
		}
		const nextRevision = currentRevision + 1;
		statements.revisionInsert.run({
			document_id: documentId,
			revision: nextRevision,
			schema: JSON.stringify(currentSnapshot.schema),
			data: JSON.stringify(data),
		});
		statements.documentTouch.run({ document_id: documentId });
		db.exec("COMMIT");
		return requiredRevision(
			statements.revisionSelect.get(documentId, nextRevision),
		);
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Schema and data form one revision and must commit with the current-schema pointer.
function replaceSchema(
	db: DatabaseSync,
	statements: DocumentStateStatements,
	documentId: string,
	expectedRevision: number,
	schema: DocumentStateSchema,
	data: DocumentStateData,
): DocumentStateRevision {
	db.exec("BEGIN");
	try {
		const current = statements.revisionSelectCurrent.get(documentId);
		if (!current) {
			throw new Error(`Document state not found for id "${documentId}".`);
		}
		const currentRevision = revisionFromRow(current).revision;
		if (currentRevision !== expectedRevision) {
			throw new Error(
				`Document state revision conflict: expected ${expectedRevision}, current ${currentRevision}.`,
			);
		}
		const nextRevision = currentRevision + 1;
		statements.stateUpdate.run({
			document_id: documentId,
			schema: JSON.stringify(schema),
		});
		statements.revisionInsert.run({
			document_id: documentId,
			revision: nextRevision,
			schema: JSON.stringify(schema),
			data: JSON.stringify(data),
		});
		statements.documentTouch.run({ document_id: documentId });
		db.exec("COMMIT");
		return requiredRevision(
			statements.revisionSelect.get(documentId, nextRevision),
		);
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Preparing SQL statements is database-adapter setup, not domain ownership.
function prepareStatements(db: DatabaseSync): DocumentStateStatements {
	return {
		stateInsert: db.prepare(
			"INSERT INTO document_states (document_id, schema) VALUES ($document_id, $schema)",
		),
		stateSelect: db.prepare(
			"SELECT document_id, schema, created_at FROM document_states WHERE document_id = ?",
		),
		stateUpdate: db.prepare(
			"UPDATE document_states SET schema = $schema WHERE document_id = $document_id",
		),
		revisionInsert: db.prepare(
			"INSERT INTO document_state_revisions (document_id, revision, schema, data) VALUES ($document_id, $revision, $schema, $data)",
		),
		revisionSelect: db.prepare(
			"SELECT document_id, revision, schema, data, created_at FROM document_state_revisions WHERE document_id = ? AND revision = ?",
		),
		revisionSelectCurrent: db.prepare(
			"SELECT document_id, revision, schema, data, created_at FROM document_state_revisions WHERE document_id = ? ORDER BY revision DESC LIMIT 1",
		),
		revisionSelectAll: db.prepare(
			"SELECT document_id, revision, schema, data, created_at FROM document_state_revisions WHERE document_id = ? ORDER BY revision DESC",
		),
		documentMarkState: db.prepare(
			`UPDATE documents SET data_model = 'state', updated_at = ${NEXT_DOCUMENT_UPDATED_AT_SQL} WHERE id = $document_id`,
		),
		documentTouch: db.prepare(
			`UPDATE documents SET updated_at = ${NEXT_DOCUMENT_UPDATED_AT_SQL} WHERE id = $document_id`,
		),
	};
}

function stateFromRow(row: unknown): StoredDocumentState {
	const value = row as {
		document_id: string;
		schema: string;
		created_at: string;
	};
	return {
		documentId: value.document_id,
		schema: JSON.parse(value.schema),
		createdAt: value.created_at,
	};
}

function revisionFromRow(row: unknown): DocumentStateRevision {
	const value = row as {
		document_id: string;
		revision: number;
		schema: string;
		data: string;
		created_at: string;
	};
	return {
		documentId: value.document_id,
		revision: value.revision,
		schema: JSON.parse(value.schema),
		data: JSON.parse(value.data),
		createdAt: value.created_at,
	};
}

function requiredRevision(row: unknown): DocumentStateRevision {
	if (!row) throw new Error("Document state revision was not persisted.");
	return revisionFromRow(row);
}
