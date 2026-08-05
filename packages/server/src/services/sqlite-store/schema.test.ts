import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createAssetRepository } from "./asset-repository.js";
import { createCharteRepository } from "./charte-repository.js";
import { createCollectionRepository } from "./collection-repository.js";
import { createDocumentRepository } from "./document-repository.js";
import { initializeSQLiteSchema } from "./schema.js";

describe("SQLite schema migrations", () => {
	it("migrates the real historical shape without losing data", () => {
		const db = historicalDatabaseWithoutIds(5);
		const businessDataBefore = businessData(db);

		initializeSQLiteSchema(db);
		initializeSQLiteSchema(db);

		expect(schemaVersion(db)).toBe(11);
		expect(tableCount(db, "documents")).toBe(2);
		expect(tableCount(db, "pages")).toBe(2);
		expect(hasUniqueDocumentIdIndex(db)).toBe(true);
		expect(integrityCheck(db)).toEqual(["ok"]);
		expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
		expect(businessData(db)).toEqual(businessDataBefore);

		const documents = createDocumentRepository(db);
		const chartes = createCharteRepository(db);
		const collections = createCollectionRepository(db);
		const assets = createAssetRepository(db);
		expect(documents.loadAll().map((doc) => doc.name)).toEqual([
			"first",
			"second",
		]);
		expect(chartes.loadAllChartes()).toHaveLength(1);
		expect(collections.loadAllCollections()).toEqual([]);
		expect(assets.loadAllAssets()).toHaveLength(1);

		db.exec(`
			CREATE TABLE state_fk_probe (
				document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE
			);
		`);
		const firstId = db
			.prepare("SELECT id FROM documents WHERE name = 'first'")
			.get() as { id: string };
		db.prepare("INSERT INTO state_fk_probe (document_id) VALUES (?)").run(
			firstId.id,
		);
		expect(tableCount(db, "state_fk_probe")).toBe(1);
		db.close();
	});

	it("migrates the historical v8 schema to living document state", () => {
		const db = historicalV8Database();
		const dataBefore = collectionData(db);

		initializeSQLiteSchema(db);
		initializeSQLiteSchema(db);

		expect(schemaVersion(db)).toBe(11);
		expect(hasUniqueDocumentIdIndex(db)).toBe(true);
		expect(hasTable(db, "document_states")).toBe(true);
		expect(hasTable(db, "document_state_revisions")).toBe(true);
		expect(
			(
				db
					.prepare("SELECT data_model FROM documents WHERE name = 'first'")
					.get() as { data_model: string }
			).data_model,
		).toBe("collection");
		expect(collectionData(db)).toEqual(dataBefore);
		db.close();
	});

	it("repairs the invalid schema left by the abandoned state migration", () => {
		const db = poisonedStateDatabase();
		const dataBefore = stateData(db);

		initializeSQLiteSchema(db);
		initializeSQLiteSchema(db);

		expect(schemaVersion(db)).toBe(11);
		expect(hasUniqueDocumentIdIndex(db)).toBe(true);
		expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
		expect(createDocumentRepository(db).loadAll()).toHaveLength(2);
		expect(stateData(db)).toEqual(dataBefore);
		expect(
			(
				db
					.prepare(
						"SELECT schema FROM document_state_revisions WHERE document_id = 'doc-first' AND revision = 1",
					)
					.get() as { schema: string }
			).schema,
		).toBe('{"done":"boolean"}');
		db.close();
	});

	it("adds revision schemas to v10 state data without rewriting snapshots", () => {
		const db = historicalV10StateDatabase();
		const dataBefore = stateData(db);

		initializeSQLiteSchema(db);
		initializeSQLiteSchema(db);

		expect(schemaVersion(db)).toBe(11);
		expect(hasColumn(db, "document_state_revisions", "schema")).toBe(true);
		expect(stateData(db)).toEqual(dataBefore);
		const rows = db
			.prepare(
				"SELECT revisions.schema, states.schema AS current_schema FROM document_state_revisions AS revisions JOIN document_states AS states USING (document_id)",
			)
			.all() as Array<{ schema: string; current_schema: string }>;
		expect(rows).toHaveLength(1);
		expect(rows[0]?.schema).toBe(rows[0]?.current_schema);
		db.close();
	});

	it("refuses to destroy an unsupported legacy database", () => {
		const db = historicalDatabaseWithoutIds(4);

		expect(() => initializeSQLiteSchema(db)).toThrow(
			/schema v4 contains data but cannot be migrated safely/,
		);
		expect(schemaVersion(db)).toBe(4);
		expect(tableCount(db, "documents")).toBe(2);
		expect(tableCount(db, "pages")).toBe(2);
		db.close();
	});

	it("refuses to downgrade a newer database", () => {
		const db = historicalDatabaseWithoutIds(12);

		expect(() => initializeSQLiteSchema(db)).toThrow(
			/schema v12 is newer than supported v11/,
		);
		expect(schemaVersion(db)).toBe(12);
		expect(tableCount(db, "documents")).toBe(2);
		db.close();
	});

	it("rolls back when document ids are duplicated", () => {
		const db = historicalDatabaseWithoutIds(5);
		db.exec("ALTER TABLE documents ADD COLUMN id TEXT;");
		db.exec("UPDATE documents SET id = 'duplicate';");
		const businessDataBefore = businessData(db);

		expect(() => initializeSQLiteSchema(db)).toThrow(/duplicate value/);
		expect(schemaVersion(db)).toBe(5);
		expect(hasUniqueDocumentIdIndex(db)).toBe(false);
		expect(hasTable(db, "collections")).toBe(false);
		expect(hasColumn(db, "pages", "id")).toBe(false);
		expect(hasColumn(db, "pages", "collection")).toBe(false);
		expect(businessData(db)).toEqual(businessDataBefore);
		db.close();
	});

	it("creates a fresh schema idempotently", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys = ON;");

		initializeSQLiteSchema(db);
		initializeSQLiteSchema(db);

		expect(schemaVersion(db)).toBe(11);
		expect(hasUniqueDocumentIdIndex(db)).toBe(true);
		expect(integrityCheck(db)).toEqual(["ok"]);
		db.close();
	});
});

function historicalDatabaseWithoutIds(version: number): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec(`
		CREATE TABLE documents (
			name TEXT PRIMARY KEY,
			category TEXT NOT NULL DEFAULT 'general',
			canvas TEXT NOT NULL,
			meta TEXT NOT NULL DEFAULT '{}',
			active_page INTEGER NOT NULL DEFAULT 0,
			next_id INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE pages (
			doc_name TEXT NOT NULL REFERENCES documents(name) ON DELETE CASCADE,
			idx INTEGER NOT NULL,
			name TEXT NOT NULL DEFAULT 'Page 1',
			html TEXT,
			elements TEXT NOT NULL DEFAULT '[]',
			canvas TEXT,
			PRIMARY KEY (doc_name, idx)
		);
		CREATE TABLE chartes (
			name TEXT PRIMARY KEY,
			data TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE assets (
			filename TEXT PRIMARY KEY,
			title TEXT,
			description TEXT,
			category TEXT,
			tags TEXT NOT NULL DEFAULT '[]',
			credit TEXT,
			width INTEGER,
			height INTEGER,
			orientation TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		INSERT INTO documents (name, canvas) VALUES
			('first', '{"format":"A4","orientation":"portrait","w":210,"h":297,"bg":"#fff"}'),
			('second', '{"format":"A4","orientation":"portrait","w":210,"h":297,"bg":"#fff"}');
		INSERT INTO pages (doc_name, idx, html) VALUES
			('first', 0, '<p>First</p>'),
			('second', 0, '<p>Second</p>');
		INSERT INTO chartes (name, data) VALUES ('brand', '{"colors":["#123456"]}');
		INSERT INTO assets (filename, title, tags, width, height)
		VALUES ('logo.png', 'Logo', '["brand"]', 120, 80);
		PRAGMA user_version = ${version};
	`);
	return db;
}

function poisonedStateDatabase(): DatabaseSync {
	const db = historicalV8Database();
	db.exec(
		"ALTER TABLE documents ADD COLUMN data_model TEXT NOT NULL DEFAULT 'static';",
	);
	db.exec(
		"UPDATE documents SET data_model = 'collection' WHERE name = 'first';",
	);
	db.exec(`
		CREATE TABLE document_states (
			document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
			schema TEXT NOT NULL CHECK (json_valid(schema)),
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE document_state_revisions (
			document_id TEXT NOT NULL REFERENCES document_states(document_id) ON DELETE CASCADE,
			revision INTEGER NOT NULL CHECK (revision > 0),
			data TEXT NOT NULL CHECK (json_valid(data)),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (document_id, revision)
		);
		PRAGMA foreign_keys = OFF;
		INSERT INTO document_states (document_id, schema)
		VALUES ('doc-first', '{"done":"boolean"}');
		INSERT INTO document_state_revisions (document_id, revision, data)
		VALUES ('doc-first', 1, '{"done":false}');
		PRAGMA foreign_keys = ON;
		PRAGMA user_version = 9;
	`);
	return db;
}

function historicalV10StateDatabase(): DatabaseSync {
	const db = poisonedStateDatabase();
	db.exec(
		"CREATE UNIQUE INDEX documents_id_unique_idx ON documents(id); PRAGMA user_version = 10;",
	);
	return db;
}

function historicalV8Database(): DatabaseSync {
	const db = historicalDatabaseWithoutIds(8);
	db.exec("ALTER TABLE documents ADD COLUMN id TEXT;");
	db.exec("UPDATE documents SET id = 'doc-' || name;");
	db.exec("ALTER TABLE pages ADD COLUMN id TEXT;");
	db.exec("UPDATE pages SET id = 'page-' || doc_name || '-' || idx;");
	db.exec("ALTER TABLE pages ADD COLUMN collection TEXT;");
	db.exec(`
		CREATE TABLE collections (
			name TEXT PRIMARY KEY,
			description TEXT,
			schema TEXT NOT NULL CHECK (json_valid(schema)),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE collection_rows (
			collection_name TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
			id TEXT NOT NULL,
			position INTEGER NOT NULL,
			data TEXT NOT NULL CHECK (json_valid(data)),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (collection_name, id)
		);
		CREATE UNIQUE INDEX collection_rows_position_idx
			ON collection_rows(collection_name, position);
		INSERT INTO collections (name, schema) VALUES ('clients', '{"name":"string"}');
		INSERT INTO collection_rows (collection_name, id, position, data)
		VALUES ('clients', 'client-1', 0, '{"name":"Ada"}');
		UPDATE pages SET collection = 'clients' WHERE doc_name = 'first';
	`);
	return db;
}

function schemaVersion(db: DatabaseSync): number {
	return (db.prepare("PRAGMA user_version").get() as { user_version: number })
		.user_version;
}

function tableCount(db: DatabaseSync, table: string): number {
	return (
		db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
			count: number;
		}
	).count;
}

function hasUniqueDocumentIdIndex(db: DatabaseSync): boolean {
	const rows = db
		.prepare(
			`SELECT indexes.name
			 FROM pragma_index_list('documents') AS indexes
			 JOIN pragma_index_info(indexes.name) AS columns
			 WHERE indexes."unique" = 1
			 GROUP BY indexes.name
			 HAVING count(*) = 1 AND max(columns.name = 'id') = 1`,
		)
		.all();
	return rows.length > 0;
}

function integrityCheck(db: DatabaseSync): string[] {
	return (
		db.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>
	).map((row) => String(Object.values(row)[0]));
}

function hasTable(db: DatabaseSync, table: string): boolean {
	return Boolean(
		db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
			.get(table),
	);
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
	return (
		db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
	).some((entry) => entry.name === column);
}

function businessData(db: DatabaseSync): Record<string, unknown[]> {
	return {
		documents: rows(
			db,
			"SELECT name, category, canvas, meta, active_page, next_id FROM documents ORDER BY name",
		),
		pages: rows(
			db,
			"SELECT doc_name, idx, name, html, elements, canvas FROM pages ORDER BY doc_name, idx",
		),
		chartes: rows(db, "SELECT name, data FROM chartes ORDER BY name"),
		assets: rows(
			db,
			"SELECT filename, title, description, category, tags, credit, width, height, orientation FROM assets ORDER BY filename",
		),
	};
}

function stateData(db: DatabaseSync): Record<string, unknown[]> {
	return {
		documents: rows(db, "SELECT * FROM documents ORDER BY name"),
		pages: rows(db, "SELECT * FROM pages ORDER BY doc_name, idx"),
		collections: rows(db, "SELECT * FROM collections ORDER BY name"),
		collectionRows: rows(
			db,
			"SELECT * FROM collection_rows ORDER BY collection_name, position",
		),
		states: rows(db, "SELECT * FROM document_states ORDER BY document_id"),
		revisions: rows(
			db,
			"SELECT document_id, revision, data, created_at FROM document_state_revisions ORDER BY document_id, revision",
		),
	};
}

function collectionData(db: DatabaseSync): Record<string, unknown[]> {
	return {
		documents: rows(
			db,
			"SELECT name, id, category, canvas, meta, active_page, next_id FROM documents ORDER BY name",
		),
		pages: rows(db, "SELECT * FROM pages ORDER BY doc_name, idx"),
		collections: rows(db, "SELECT * FROM collections ORDER BY name"),
		collectionRows: rows(
			db,
			"SELECT * FROM collection_rows ORDER BY collection_name, position",
		),
	};
}

function rows(db: DatabaseSync, sql: string): unknown[] {
	return db.prepare(sql).all();
}
