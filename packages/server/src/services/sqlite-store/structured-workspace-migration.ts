/**
 * Schema v22 of Structured Workspace items: the insertion sequence and the
 * declared identity.
 *
 * Each item row keeps its insertion order in `sequence`, taken from a stored
 * per-collection counter that only grows, so a sequence is never given twice.
 * Each collection declares its identity, as declareMissingIdentities
 * chooses it (the same declaration an import applies to a bundle written
 * before identities): the row id is copied under the chosen property in
 * every row and the workspace revision grows.
 */

import type { DatabaseSync } from "node:sqlite";
import { declareMissingIdentities } from "@maket/shared";

/** The identity declared on one collection by the migration. */
export interface DeclaredIdentity {
	workspaceId: string;
	workspace: string;
	collectionId: string;
	/** The property holding the identity. */
	property: string;
	/** Whether an existing `id` property already held the row ids. */
	kept: boolean;
}

/** Replace the position column by the sequence and create the counters. */
export function migrateItemsToSequence(db: DatabaseSync): void {
	if (hasPositionColumn(db)) {
		db.exec(`
			CREATE TABLE structured_workspace_items_v22 (
				workspace_id  TEXT NOT NULL REFERENCES structured_workspaces(id) ON DELETE CASCADE,
				id            TEXT NOT NULL,
				sequence      INTEGER NOT NULL,
				collection_id TEXT NOT NULL,
				binding_id    TEXT NOT NULL,
				document_id   TEXT NOT NULL UNIQUE,
				document_name TEXT NOT NULL,
				data          TEXT CHECK (data IS NULL OR json_valid(data)),
				revision      INTEGER NOT NULL CHECK (revision > 0),
				created_at    TEXT NOT NULL DEFAULT (datetime('now')),
				PRIMARY KEY (workspace_id, id),
				UNIQUE (workspace_id, collection_id, sequence),
				UNIQUE (workspace_id, document_name)
			);
			INSERT INTO structured_workspace_items_v22
				(workspace_id, id, sequence, collection_id, binding_id, document_id,
				 document_name, data, revision, created_at)
			SELECT workspace_id, id, position + 1, collection_id, binding_id,
				document_id, document_name, data, revision, created_at
			FROM structured_workspace_items;
			DROP TABLE structured_workspace_items;
			ALTER TABLE structured_workspace_items_v22 RENAME TO structured_workspace_items;
		`);
	}
	db.exec(`
		CREATE INDEX IF NOT EXISTS structured_workspace_items_document_name_idx
			ON structured_workspace_items(document_name);
		CREATE TABLE IF NOT EXISTS structured_workspace_sequences (
			workspace_id  TEXT NOT NULL REFERENCES structured_workspaces(id) ON DELETE CASCADE,
			collection_id TEXT NOT NULL,
			last          INTEGER NOT NULL,
			PRIMARY KEY (workspace_id, collection_id)
		);
		INSERT OR IGNORE INTO structured_workspace_sequences (workspace_id, collection_id, last)
			SELECT workspace_id, collection_id, max(sequence)
			FROM structured_workspace_items GROUP BY workspace_id, collection_id;
	`);
}

function hasPositionColumn(db: DatabaseSync): boolean {
	return (
		db.prepare("PRAGMA table_info(structured_workspace_items)").all() as Array<{
			name: string;
		}>
	).some((column) => column.name === "position");
}

/** Declare an identity on every collection that has none; idempotent. */
export function declareItemIdentities(db: DatabaseSync): DeclaredIdentity[] {
	const workspaces = db
		.prepare(
			"SELECT id, name, data_schema, representation_schema FROM structured_workspaces ORDER BY created_at ASC, id ASC",
		)
		.all() as Array<{
		id: string;
		name: string;
		data_schema: string;
		representation_schema: string;
	}>;
	const rowsOf = db.prepare(
		"SELECT id, data FROM structured_workspace_items WHERE workspace_id = ? AND collection_id = ?",
	);
	const copyId = db.prepare(
		"UPDATE structured_workspace_items SET data = json_set(data, $path, id) WHERE workspace_id = $workspace AND collection_id = $collection AND data IS NOT NULL",
	);
	const save = db.prepare(
		"UPDATE structured_workspaces SET data_schema = $data, representation_schema = $representation, revision = revision + 1, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = $id",
	);
	const declared: DeclaredIdentity[] = [];
	for (const workspace of workspaces) {
		const result = declareMissingIdentities(
			JSON.parse(workspace.data_schema),
			JSON.parse(workspace.representation_schema) as object,
			(collectionId) =>
				(
					rowsOf.all(workspace.id, collectionId) as Array<{
						id: string;
						data: string | null;
					}>
				).map((row) => ({
					id: row.id,
					data: row.data === null ? null : JSON.parse(row.data),
				})),
		);
		if (result.declared.length === 0) continue;
		for (const identity of result.declared) {
			if (!identity.kept)
				copyId.run({
					$path: `$."${identity.property}"`,
					$workspace: workspace.id,
					$collection: identity.collectionId,
				});
			declared.push({
				workspaceId: workspace.id,
				workspace: workspace.name,
				...identity,
			});
		}
		save.run({
			$id: workspace.id,
			$data: JSON.stringify(result.dataSchema),
			$representation: JSON.stringify(result.representationSchema),
		});
	}
	return declared;
}
