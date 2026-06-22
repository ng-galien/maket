import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 8;

const log = (...a: unknown[]) =>
	process.stderr.write(`${a.map(String).join(" ")}\n`);

const SCHEMA_SQL = `
  CREATE TABLE documents (
    name       TEXT PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    category   TEXT NOT NULL DEFAULT 'general',
    canvas     TEXT NOT NULL,
    meta       TEXT NOT NULL DEFAULT '{}',
    active_page INTEGER NOT NULL DEFAULT 0,
    next_id    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
`;

export function initializeSQLiteSchema(db: DatabaseSync): void {
	initializeBaseSchema(db);
	ensureCollectionSchema(db);
	backfillDocumentIds(db);
	backfillPageIds(db);
	assertPageIdsBackfilled(db);
}

function initializeBaseSchema(db: DatabaseSync): void {
	const version =
		(
			db.prepare("PRAGMA user_version").get() as unknown as {
				user_version?: number;
			} | null
		)?.user_version ?? 0;

	if (version >= 5) return;
	db.exec("DROP TABLE IF EXISTS documents;");
	db.exec("DROP TABLE IF EXISTS pages;");
	db.exec("DROP TABLE IF EXISTS chartes;");
	db.exec("DROP TABLE IF EXISTS assets;");
	db.exec(SCHEMA_SQL);
	db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
	log(`SQLite: schema v${SCHEMA_VERSION} created (clean)`);
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
	db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

function backfillDocumentIds(db: DatabaseSync): void {
	if (!hasTable(db, "documents") || hasColumn(db, "documents", "id")) return;
	db.exec("ALTER TABLE documents ADD COLUMN id TEXT;");
	const rows = db.prepare("SELECT name FROM documents").all() as {
		name: string;
	}[];
	const stmt = db.prepare("UPDATE documents SET id = $id WHERE name = $name");
	for (const row of rows) stmt.run({ id: crypto.randomUUID(), name: row.name });
	db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
	log(`SQLite: added id column to documents (backfilled ${rows.length} rows)`);
}

function backfillPageIds(db: DatabaseSync): void {
	if (!hasTable(db, "pages") || hasColumn(db, "pages", "id")) return;
	db.exec("ALTER TABLE pages ADD COLUMN id TEXT;");
	const rows = db.prepare("SELECT doc_name, idx FROM pages").all() as Array<{
		doc_name: string;
		idx: number;
	}>;
	const stmt = db.prepare(
		"UPDATE pages SET id = $id WHERE doc_name = $doc_name AND idx = $idx",
	);
	for (const row of rows) stmt.run({ ...row, id: crypto.randomUUID() });
	db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
	log(`SQLite: added id column to pages (backfilled ${rows.length} rows)`);
}

function assertPageIdsBackfilled(db: DatabaseSync): void {
	if (!hasTable(db, "pages")) return;
	if (!hasColumn(db, "pages", "id")) {
		throw new Error("SQLite migration failed: pages.id column is missing");
	}
	const row = db
		.prepare("SELECT count(*) AS count FROM pages WHERE id IS NULL OR id = ''")
		.get() as { count: number };
	if (row.count > 0) {
		throw new Error(
			`SQLite migration failed: ${row.count} page row(s) still have no id`,
		);
	}
}

function addColumnIfMissing(
	db: DatabaseSync,
	table: string,
	column: string,
	type: string,
): void {
	if (!hasTable(db, table) || hasColumn(db, table, column)) return;
	db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
		name: string;
	}[];
	return cols.some((entry) => entry.name === column);
}

function hasTable(db: DatabaseSync, table: string): boolean {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
		.get(table);
	return Boolean(row);
}
