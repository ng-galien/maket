import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { initializeSQLiteSchema } from "./schema.js";

describe("SQLite schema v9 migration", () => {
	it("backfills collection data models and creates state snapshot tables", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(`
      CREATE TABLE documents (
        name TEXT PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
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
        id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Page 1',
        html TEXT,
        elements TEXT NOT NULL DEFAULT '[]',
        canvas TEXT,
        collection TEXT,
        PRIMARY KEY (doc_name, idx)
      );
      CREATE TABLE chartes (name TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE assets (filename TEXT PRIMARY KEY);
      INSERT INTO documents (name, id, canvas) VALUES ('letters', 'doc-1', '{}');
      INSERT INTO pages (doc_name, idx, id, collection) VALUES ('letters', 0, 'page-1', 'clients');
      PRAGMA user_version = 8;
    `);

		initializeSQLiteSchema(db);

		expect(
			(
				db
					.prepare("SELECT data_model FROM documents WHERE id = 'doc-1'")
					.get() as {
					data_model: string;
				}
			).data_model,
		).toBe("collection");
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'document_state%' ORDER BY name",
			)
			.all() as Array<{ name: string }>;
		expect(tables.map((row) => row.name)).toEqual([
			"document_state_revisions",
			"document_states",
		]);
		expect(
			(db.prepare("PRAGMA user_version").get() as { user_version: number })
				.user_version,
		).toBe(9);
		db.close();
	});
});
