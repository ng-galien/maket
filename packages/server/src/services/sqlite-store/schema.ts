import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 12;
const MINIMUM_MIGRATABLE_VERSION = 5;

const log = (...a: unknown[]) =>
	process.stderr.write(`${a.map(String).join(" ")}\n`);

const SCHEMA_SQL = `
  CREATE TABLE documents (
    name       TEXT PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    category   TEXT NOT NULL DEFAULT 'general',
    data_model TEXT NOT NULL DEFAULT 'static',
    canvas     TEXT NOT NULL,
    meta       TEXT NOT NULL DEFAULT '{}',
    active_page INTEGER NOT NULL DEFAULT 0,
    next_id    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
  );
  CREATE TABLE pages (
    doc_name   TEXT NOT NULL REFERENCES documents(name) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    id         TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT 'Page 1',
    html       TEXT,
    elements   TEXT NOT NULL DEFAULT '[]',
    canvas     TEXT,
    collection TEXT,
    PRIMARY KEY (doc_name, idx)
  );
  CREATE TABLE chartes (
    name       TEXT PRIMARY KEY,
    data       TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE assets (
    filename    TEXT PRIMARY KEY,
    title       TEXT,
    description TEXT,
    category    TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',
    credit      TEXT,
    width       INTEGER,
    height      INTEGER,
    orientation TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE collections (
    name        TEXT PRIMARY KEY,
    description TEXT,
    schema      TEXT NOT NULL CHECK (json_valid(schema)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE collection_rows (
    collection_name TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
    id              TEXT NOT NULL,
    position        INTEGER NOT NULL,
    data            TEXT NOT NULL CHECK (json_valid(data)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_name, id)
  );
  CREATE UNIQUE INDEX collection_rows_position_idx
    ON collection_rows(collection_name, position);
  CREATE TABLE document_states (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    schema      TEXT NOT NULL CHECK (json_valid(schema)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE document_state_revisions (
    document_id TEXT NOT NULL REFERENCES document_states(document_id) ON DELETE CASCADE,
    revision    INTEGER NOT NULL CHECK (revision > 0),
		schema      TEXT NOT NULL CHECK (json_valid(schema)),
    data        TEXT NOT NULL CHECK (json_valid(data)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (document_id, revision)
  );
  CREATE TABLE annotations (
    id          TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    page_index  INTEGER,
    element_id  TEXT,
    type        TEXT NOT NULL,
    text        TEXT,
    file        TEXT,
    position    TEXT,
    ts          INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

interface SchemaMigration {
	version: number;
	up(db: DatabaseSync): void;
}

const MIGRATIONS: readonly SchemaMigration[] = [
	{ version: 8, up: migrateToV8 },
	{ version: 9, up: migrateToV9 },
	{ version: 10, up: migrateToV10 },
	{ version: 11, up: migrateToV11 },
	{ version: 12, up: migrateToV12 },
];

export function initializeSQLiteSchema(db: DatabaseSync): void {
	const initialVersion = readSchemaVersion(db);
	if (initialVersion > SCHEMA_VERSION) {
		throw new Error(
			`SQLite schema v${initialVersion} is newer than supported v${SCHEMA_VERSION}. Refusing to downgrade it.`,
		);
	}

	const hasApplicationTables = listApplicationTables(db).length > 0;
	if (!hasApplicationTables) {
		inTransaction(db, () => {
			db.exec(SCHEMA_SQL);
			setSchemaVersion(db, SCHEMA_VERSION);
			assertCurrentSchema(db);
		});
		return;
	}

	if (initialVersion < MINIMUM_MIGRATABLE_VERSION) {
		throw new Error(
			`SQLite schema v${initialVersion} contains data but cannot be migrated safely. No tables were changed.`,
		);
	}

	assertRequiredBaseTables(db);
	inTransaction(db, () => {
		let version = initialVersion;
		for (const migration of MIGRATIONS) {
			if (migration.version <= version) continue;
			migration.up(db);
			setSchemaVersion(db, migration.version);
			version = migration.version;
		}

		replaySchemaInvariants(db);
		assertCurrentSchema(db);
		setSchemaVersion(db, SCHEMA_VERSION);
	});
}

function replaySchemaInvariants(db: DatabaseSync): void {
	migrateToV8(db);
	migrateToV9(db);
	migrateToV10(db);
	migrateToV11(db);
	migrateToV12(db);
}

function migrateToV8(db: DatabaseSync): void {
	ensureCollectionSchema(db);
	ensureDocumentIds(db);
	ensurePageIds(db);
}

function migrateToV9(db: DatabaseSync): void {
	ensureDocumentIds(db);
	assertDocumentIdsUnique(db);
	if (!hasUniqueIndexForColumn(db, "documents", "id")) {
		db.exec("CREATE UNIQUE INDEX documents_id_unique_idx ON documents(id);");
	}
}

function migrateToV10(db: DatabaseSync): void {
	migrateToV9(db);
	ensureDocumentStateSchema(db);
	ensureDocumentDataModel(db);
}

function migrateToV11(db: DatabaseSync): void {
	migrateToV10(db);
	addColumnIfMissing(db, "document_state_revisions", "schema", "TEXT");
	db.exec(`
		UPDATE document_state_revisions
		SET schema = (
			SELECT document_states.schema
			FROM document_states
			WHERE document_states.document_id = document_state_revisions.document_id
		)
		WHERE schema IS NULL OR schema = '';
	`);
}

function migrateToV12(db: DatabaseSync): void {
	migrateToV11(db);
	db.exec(`
    CREATE TABLE IF NOT EXISTS annotations (
      id          TEXT PRIMARY KEY,
      document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
      page_index  INTEGER,
      element_id  TEXT,
      type        TEXT NOT NULL,
      text        TEXT,
      file        TEXT,
      position    TEXT,
      ts          INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function ensureDocumentStateSchema(db: DatabaseSync): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS document_states (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      schema      TEXT NOT NULL CHECK (json_valid(schema)),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS document_state_revisions (
      document_id TEXT NOT NULL REFERENCES document_states(document_id) ON DELETE CASCADE,
      revision    INTEGER NOT NULL CHECK (revision > 0),
      data        TEXT NOT NULL CHECK (json_valid(data)),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (document_id, revision)
    );
  `);
}

function ensureDocumentDataModel(db: DatabaseSync): void {
	addColumnIfMissing(
		db,
		"documents",
		"data_model",
		"TEXT NOT NULL DEFAULT 'static'",
	);
	db.exec(`
    UPDATE documents
    SET data_model = 'collection'
    WHERE data_model = 'static'
      AND EXISTS (
        SELECT 1 FROM pages
        WHERE pages.doc_name = documents.name
          AND pages.collection IS NOT NULL
      );
  `);
}

function ensureCollectionSchema(db: DatabaseSync): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      name        TEXT PRIMARY KEY,
      description TEXT,
      schema      TEXT NOT NULL CHECK (json_valid(schema)),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_rows (
      collection_name TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
      id              TEXT NOT NULL,
      position        INTEGER NOT NULL,
      data            TEXT NOT NULL CHECK (json_valid(data)),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (collection_name, id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS collection_rows_position_idx
      ON collection_rows(collection_name, position);
  `);
	addColumnIfMissing(db, "pages", "collection", "TEXT");
}

function ensureDocumentIds(db: DatabaseSync): void {
	addColumnIfMissing(db, "documents", "id", "TEXT");
	const rows = db
		.prepare("SELECT name FROM documents WHERE id IS NULL OR id = ''")
		.all() as Array<{ name: string }>;
	if (rows.length === 0) return;
	const stmt = db.prepare("UPDATE documents SET id = $id WHERE name = $name");
	for (const row of rows) stmt.run({ id: crypto.randomUUID(), name: row.name });
	log(`SQLite: backfilled ${rows.length} missing document id(s)`);
}

function ensurePageIds(db: DatabaseSync): void {
	addColumnIfMissing(db, "pages", "id", "TEXT");
	const rows = db
		.prepare("SELECT doc_name, idx FROM pages WHERE id IS NULL OR id = ''")
		.all() as Array<{ doc_name: string; idx: number }>;
	if (rows.length === 0) return;
	const stmt = db.prepare(
		"UPDATE pages SET id = $id WHERE doc_name = $doc_name AND idx = $idx",
	);
	for (const row of rows) stmt.run({ ...row, id: crypto.randomUUID() });
	log(`SQLite: backfilled ${rows.length} missing page id(s)`);
}

function assertCurrentSchema(db: DatabaseSync): void {
	assertRequiredBaseTables(db);
	assertNoMissingIds(db, "documents", "id");
	assertNoMissingIds(db, "pages", "id");
	assertDocumentIdsUnique(db);
	if (!hasUniqueIndexForColumn(db, "documents", "id")) {
		throw new Error("SQLite migration failed: documents.id is not UNIQUE");
	}
	assertRevisionSchemas(db);
	assertAnnotationsSchema(db);
	assertIntegrity(db);
}

function assertAnnotationsSchema(db: DatabaseSync): void {
	if (!hasTable(db, "annotations")) {
		throw new Error("SQLite migration failed: annotations table is missing");
	}
	const columns = new Set(
		(
			db.prepare("PRAGMA table_info(annotations)").all() as Array<{
				name: string;
			}>
		).map((column) => column.name),
	);
	for (const required of [
		"id",
		"document_id",
		"page_index",
		"element_id",
		"type",
		"text",
		"file",
		"position",
		"ts",
		"created_at",
	]) {
		if (!columns.has(required)) {
			throw new Error(
				`SQLite migration failed: annotations.${required} is missing`,
			);
		}
	}
	const documentForeignKey = (
		db.prepare("PRAGMA foreign_key_list(annotations)").all() as Array<{
			from: string;
			table: string;
			to: string;
			on_delete: string;
		}>
	).find((key) => key.from === "document_id");
	if (
		documentForeignKey?.table !== "documents" ||
		documentForeignKey.to !== "id" ||
		documentForeignKey.on_delete.toUpperCase() !== "CASCADE"
	) {
		throw new Error(
			"SQLite migration failed: annotations.document_id foreign key is invalid",
		);
	}
}

function assertRevisionSchemas(db: DatabaseSync): void {
	if (!hasTable(db, "document_state_revisions")) return;
	if (!hasColumn(db, "document_state_revisions", "schema")) {
		throw new Error(
			"SQLite migration failed: document_state_revisions.schema is missing",
		);
	}
	const row = db
		.prepare(
			"SELECT count(*) AS count FROM document_state_revisions WHERE schema IS NULL OR schema = '' OR NOT json_valid(schema)",
		)
		.get() as { count: number };
	if (row.count > 0) {
		throw new Error(
			`SQLite migration failed: document_state_revisions.schema has ${row.count} invalid value(s)`,
		);
	}
}

function assertDocumentIdsUnique(db: DatabaseSync): void {
	const duplicate = db
		.prepare(
			"SELECT id, count(*) AS count FROM documents GROUP BY id HAVING count(*) > 1 LIMIT 1",
		)
		.get() as { id: string; count: number } | undefined;
	if (duplicate) {
		throw new Error(
			`SQLite migration failed: documents.id contains duplicate value "${duplicate.id}" (${duplicate.count} rows)`,
		);
	}
}

function assertNoMissingIds(
	db: DatabaseSync,
	table: "documents" | "pages",
	column: "id",
): void {
	const row = db
		.prepare(
			`SELECT count(*) AS count FROM ${table} WHERE ${column} IS NULL OR ${column} = ''`,
		)
		.get() as { count: number };
	if (row.count > 0) {
		throw new Error(
			`SQLite migration failed: ${table}.${column} has ${row.count} missing value(s)`,
		);
	}
}

function assertIntegrity(db: DatabaseSync): void {
	const integrityRows = db.prepare("PRAGMA integrity_check").all() as Array<
		Record<string, unknown>
	>;
	const integrityMessages = integrityRows.map((row) =>
		String(Object.values(row)[0]),
	);
	if (integrityMessages.length !== 1 || integrityMessages[0] !== "ok") {
		throw new Error(
			`SQLite integrity check failed: ${integrityMessages.join("; ")}`,
		);
	}

	const foreignKeyIssues = db.prepare("PRAGMA foreign_key_check").all();
	if (foreignKeyIssues.length > 0) {
		throw new Error(
			`SQLite foreign key check failed: ${foreignKeyIssues.length} violation(s)`,
		);
	}
}

function hasUniqueIndexForColumn(
	db: DatabaseSync,
	table: string,
	column: string,
): boolean {
	const rows = db
		.prepare(
			`SELECT indexes.name
			 FROM pragma_index_list(?) AS indexes
			 JOIN pragma_index_info(indexes.name) AS columns
			 WHERE indexes."unique" = 1
			 GROUP BY indexes.name
			 HAVING count(*) = 1 AND max(columns.name = ?) = 1`,
		)
		.all(table, column);
	return rows.length > 0;
}

function assertRequiredBaseTables(db: DatabaseSync): void {
	const required = ["documents", "pages", "chartes", "assets"];
	const missing = required.filter((table) => !hasTable(db, table));
	if (missing.length > 0) {
		throw new Error(
			`SQLite schema is incomplete; missing table(s): ${missing.join(", ")}. No tables were changed.`,
		);
	}
}

function addColumnIfMissing(
	db: DatabaseSync,
	table: string,
	column: string,
	type: string,
): void {
	if (hasColumn(db, table, column)) return;
	db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
	}>;
	return cols.some((entry) => entry.name === column);
}

function hasTable(db: DatabaseSync, table: string): boolean {
	return Boolean(
		db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
			.get(table),
	);
}

function listApplicationTables(db: DatabaseSync): string[] {
	return (
		db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
			)
			.all() as Array<{ name: string }>
	).map((row) => row.name);
}

function readSchemaVersion(db: DatabaseSync): number {
	return (
		(
			db.prepare("PRAGMA user_version").get() as {
				user_version?: number;
			} | null
		)?.user_version ?? 0
	);
}

function setSchemaVersion(db: DatabaseSync, version: number): void {
	db.exec(`PRAGMA user_version = ${version};`);
}

function inTransaction(db: DatabaseSync, action: () => void): void {
	db.exec("BEGIN IMMEDIATE");
	try {
		action();
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}
