import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
	formatCollectionTemplateIssues,
	validateCollection,
} from "@maket/shared";
import type { Collection } from "../../types.js";

const COLLECTION_UPSERT_SQL = `
  INSERT INTO collections (name, description, schema, created_at, updated_at)
  VALUES ($name, $description, $schema, datetime('now'), datetime('now'))
  ON CONFLICT(name) DO UPDATE SET
    description = excluded.description,
    schema      = excluded.schema,
    updated_at  = datetime('now')
`;

const COLLECTION_ROW_INSERT_SQL = `
  INSERT INTO collection_rows (collection_name, id, position, data, created_at, updated_at)
  VALUES ($collection_name, $id, $position, $data, datetime('now'), datetime('now'))
`;

export interface CollectionRepository {
	saveCollection(c: Collection): void;
	loadAllCollections(): Collection[];
	loadCollection(name: string): Collection | null;
	deleteCollection(name: string): boolean;
}

export function createCollectionRepository(
	db: DatabaseSync,
): CollectionRepository {
	const statements = prepareCollectionStatements(db);

	return {
		saveCollection(c) {
			assertValidCollection(c);
			db.exec("BEGIN");
			try {
				statements.collectionUpsert.run({
					name: c.name,
					description: c.description ?? null,
					schema: JSON.stringify(c.schema),
				});
				statements.collectionDeleteRows.run(c.name);
				for (const member of c.members) {
					statements.collectionRowInsert.run({
						collection_name: c.name,
						id: member.id,
						position: member.position,
						data: JSON.stringify(member.data),
					});
				}
				db.exec("COMMIT");
			} catch (e) {
				db.exec("ROLLBACK");
				throw e;
			}
		},
		loadAllCollections() {
			const rows = statements.collectionSelectAll.all() as any[];
			return rows.map((member) =>
				collectionFromStorageRows(
					member,
					statements.collectionRowsByName.all(member.name) as any[],
				),
			);
		},
		loadCollection(name) {
			const member = statements.collectionSelectOne.get(name) as any;
			if (!member) return null;
			return collectionFromStorageRows(
				member,
				statements.collectionRowsByName.all(member.name) as any[],
			);
		},
		deleteCollection(name) {
			const result = statements.collectionDelete.run(name);
			return result.changes > 0;
		},
	};
}

function prepareCollectionStatements(db: DatabaseSync): {
	collectionUpsert: StatementSync;
	collectionDeleteRows: StatementSync;
	collectionDelete: StatementSync;
	collectionRowInsert: StatementSync;
	collectionSelectAll: StatementSync;
	collectionSelectOne: StatementSync;
	collectionRowsByName: StatementSync;
} {
	return {
		collectionUpsert: db.prepare(COLLECTION_UPSERT_SQL),
		collectionDeleteRows: db.prepare(
			"DELETE FROM collection_rows WHERE collection_name = ?",
		),
		collectionDelete: db.prepare("DELETE FROM collections WHERE name = ?"),
		collectionRowInsert: db.prepare(COLLECTION_ROW_INSERT_SQL),
		collectionSelectAll: db.prepare(
			"SELECT * FROM collections ORDER BY updated_at ASC",
		),
		collectionSelectOne: db.prepare("SELECT * FROM collections WHERE name = ?"),
		collectionRowsByName: db.prepare(
			"SELECT * FROM collection_rows WHERE collection_name = ? ORDER BY position ASC",
		),
	};
}

function assertValidCollection(collection: Collection): void {
	const issues = validateCollection(collection);
	if (issues.length > 0) {
		throw new Error(formatCollectionTemplateIssues(issues));
	}
}

function collectionFromStorageRows(member: any, rowData: any[]): Collection {
	return {
		name: member.name,
		description: member.description ?? undefined,
		schema: JSON.parse(member.schema),
		members: rowData.map((item) => ({
			id: item.id,
			position: item.position,
			data: JSON.parse(item.data),
		})),
	};
}
