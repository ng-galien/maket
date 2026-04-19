/**
 * store — SQLite persistence service (node:sqlite).
 *
 * `DocumentStore` owns the schema migrations and typed statements. The
 * `Store` interface is the DI-facing surface so handlers don't depend on
 * the concrete class. Tests resolve with `createSQLiteStore(":memory:")`.
 */

import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Charte, Document, Page } from "../types.js";
import { DocumentModel } from "../types.js";

const log = (...a: unknown[]) =>
	process.stderr.write(`${a.map(String).join(" ")}\n`);

const SCHEMA_VERSION = 6;

export interface AssetInput {
	filename: string;
	title?: string;
	description?: string;
	category?: string;
	tags?: string[];
	credit?: string;
	width?: number;
	height?: number;
	orientation?: string;
}

export interface AssetRow {
	filename: string;
	title: string | null;
	description: string | null;
	category: string | null;
	tags: string[];
	credit: string | null;
	width: number | null;
	height: number | null;
	orientation: string | null;
	created_at: string;
}

export interface Store {
	// Documents
	saveDoc(d: Document): void;
	saveDocs(docs: Document[]): void;
	loadAll(): Document[];
	loadOne(name: string): Document | null;
	loadById(id: string): Document | null;
	deleteDoc(name: string): void;
	isEmpty(): boolean;
	// Chartes
	saveCharte(c: Charte): void;
	loadAllChartes(): Charte[];
	loadCharte(name: string): Charte | null;
	deleteCharte(name: string): boolean;
	// Assets
	saveAsset(a: AssetInput): void;
	loadAllAssets(): AssetRow[];
	loadAsset(filename: string): AssetRow | null;
	deleteAsset(filename: string): boolean;
	// Lifecycle
	close(): void;
}

export class DocumentStore implements Store {
	private db: DatabaseSync;
	private stmtDocUpsert;
	private stmtDocSelectAll;
	private stmtDocSelectOne;
	private stmtDocDelete;
	private stmtPageUpsert;
	private stmtPageDeleteByDoc;
	private stmtPageSelectByDoc;
	private stmtCharteUpsert;
	private stmtCharteSelectAll;
	private stmtCharteSelectOne;
	private stmtCharteDelete;
	private stmtAssetUpsert;
	private stmtAssetSelectAll;
	private stmtAssetSelectOne;
	private stmtAssetDelete;

	constructor(dbPath: string) {
		this.db = new DatabaseSync(dbPath);
		this.db.exec("PRAGMA journal_mode = WAL;");

		const version =
			(
				this.db.prepare("PRAGMA user_version").get() as unknown as {
					user_version?: number;
				} | null
			)?.user_version ?? 0;

		// v5: clean schema — drop everything and recreate
		if (version < 5) {
			this.db.exec("DROP TABLE IF EXISTS documents;");
			this.db.exec("DROP TABLE IF EXISTS pages;");
			this.db.exec("DROP TABLE IF EXISTS chartes;");
			this.db.exec("DROP TABLE IF EXISTS assets;");

			this.db.exec(`
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
          name       TEXT NOT NULL DEFAULT 'Page 1',
          html       TEXT,
          elements   TEXT NOT NULL DEFAULT '[]',
          canvas     TEXT,
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
      `);
			this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
			log(`SQLite: schema v${SCHEMA_VERSION} created (clean)`);
		}

		// v6: add id column to documents (check by column existence, not version)
		const cols = this.db.prepare("PRAGMA table_info(documents)").all() as {
			name: string;
		}[];
		if (cols.length > 0 && !cols.some((c) => c.name === "id")) {
			this.db.exec("ALTER TABLE documents ADD COLUMN id TEXT;");
			const rows = this.db.prepare("SELECT name FROM documents").all() as {
				name: string;
			}[];
			const stmt = this.db.prepare(
				"UPDATE documents SET id = $id WHERE name = $name",
			);
			for (const row of rows)
				stmt.run({ id: crypto.randomUUID(), name: row.name });
			this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
			log(
				`SQLite: added id column to documents (backfilled ${rows.length} rows)`,
			);
		}

		// Documents
		this.stmtDocUpsert = this.db.prepare(`
      INSERT INTO documents (name, id, category, canvas, meta, active_page, next_id, created_at, updated_at)
      VALUES ($name, $id, $category, $canvas, $meta, $active_page, $next_id, datetime('now'), datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        id          = coalesce(excluded.id, documents.id),
        category    = excluded.category,
        canvas      = excluded.canvas,
        meta        = excluded.meta,
        active_page = excluded.active_page,
        next_id     = excluded.next_id,
        updated_at  = datetime('now')
    `);
		this.stmtDocSelectAll = this.db.prepare(
			"SELECT * FROM documents ORDER BY updated_at ASC",
		);
		this.stmtDocSelectOne = this.db.prepare(
			"SELECT * FROM documents WHERE name = $name",
		);
		this.stmtDocDelete = this.db.prepare(
			"DELETE FROM documents WHERE name = $name",
		);

		// Pages
		this.stmtPageUpsert = this.db.prepare(`
      INSERT INTO pages (doc_name, idx, name, html, elements, canvas)
      VALUES ($doc_name, $idx, $name, $html, $elements, $canvas)
      ON CONFLICT(doc_name, idx) DO UPDATE SET
        name     = excluded.name,
        html     = excluded.html,
        elements = excluded.elements,
        canvas   = excluded.canvas
    `);
		this.stmtPageDeleteByDoc = this.db.prepare(
			"DELETE FROM pages WHERE doc_name = $doc_name",
		);
		this.stmtPageSelectByDoc = this.db.prepare(
			"SELECT * FROM pages WHERE doc_name = $doc_name ORDER BY idx ASC",
		);

		// Chartes
		this.stmtCharteUpsert = this.db.prepare(`
      INSERT INTO chartes (name, data, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        data       = excluded.data,
        updated_at = datetime('now')
    `);
		this.stmtCharteSelectAll = this.db.prepare(
			"SELECT * FROM chartes ORDER BY name ASC",
		);
		this.stmtCharteSelectOne = this.db.prepare(
			"SELECT * FROM chartes WHERE name = ?",
		);
		this.stmtCharteDelete = this.db.prepare(
			"DELETE FROM chartes WHERE name = ?",
		);

		// Assets
		this.stmtAssetUpsert = this.db.prepare(`
      INSERT INTO assets (filename, title, description, category, tags, credit, width, height, orientation, created_at)
      VALUES ($filename, $title, $description, $category, $tags, $credit, $width, $height, $orientation, datetime('now'))
      ON CONFLICT(filename) DO UPDATE SET
        title = coalesce(excluded.title, assets.title),
        description = coalesce(excluded.description, assets.description),
        category = coalesce(excluded.category, assets.category),
        tags = CASE WHEN excluded.tags != '[]' THEN excluded.tags ELSE assets.tags END,
        credit = coalesce(excluded.credit, assets.credit),
        width = coalesce(excluded.width, assets.width),
        height = coalesce(excluded.height, assets.height),
        orientation = coalesce(excluded.orientation, assets.orientation)
    `);
		this.stmtAssetSelectAll = this.db.prepare(
			"SELECT * FROM assets ORDER BY created_at DESC",
		);
		this.stmtAssetSelectOne = this.db.prepare(
			"SELECT * FROM assets WHERE filename = $filename",
		);
		this.stmtAssetDelete = this.db.prepare(
			"DELETE FROM assets WHERE filename = $filename",
		);
	}

	// ---- Documents CRUD ----

	private _saveDocInner(d: Document): void {
		this.stmtDocUpsert.run({
			name: d.name,
			id: d.id,
			category: d.category || "general",
			canvas: JSON.stringify(d.canvas),
			meta: JSON.stringify(d.meta || {}),
			active_page: d.activePage,
			next_id: d.nextId,
		});
		this.stmtPageDeleteByDoc.run({ doc_name: d.name });
		for (let i = 0; i < d.pages.length; i++) {
			const p = d.pages[i];
			if (!p) continue;
			this.stmtPageUpsert.run({
				doc_name: d.name,
				idx: i,
				name: p.name || `Page ${i + 1}`,
				html: p.html || null,
				elements: JSON.stringify(p.elements || []),
				canvas: p.canvas ? JSON.stringify(p.canvas) : null,
			});
		}
	}

	saveDoc(d: Document): void {
		this.db.exec("BEGIN");
		try {
			this._saveDocInner(d);
			this.db.exec("COMMIT");
		} catch (e) {
			this.db.exec("ROLLBACK");
			throw e;
		}
	}

	saveDocs(docs: Document[]): void {
		this.db.exec("BEGIN");
		try {
			for (const d of docs) this._saveDocInner(d);
			this.db.exec("COMMIT");
		} catch (e) {
			this.db.exec("ROLLBACK");
			throw e;
		}
	}

	loadAll(): Document[] {
		// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
		const rows = this.stmtDocSelectAll.all() as any[];
		return rows.map((row) => this.rowToDoc(row));
	}

	loadOne(name: string): Document | null {
		// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
		const row = this.stmtDocSelectOne.get({ name }) as any;
		if (!row) return null;
		return this.rowToDoc(row);
	}

	loadById(id: string): Document | null {
		const row = this.db
			.prepare("SELECT * FROM documents WHERE id = ?")
			// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
			.get(id) as any;
		if (!row) return null;
		return this.rowToDoc(row);
	}

	deleteDoc(name: string): void {
		this.stmtDocDelete.run({ name });
	}

	isEmpty(): boolean {
		const row = this.db
			.prepare("SELECT COUNT(*) as cnt FROM documents")
			// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
			.get() as any;
		return (row?.cnt ?? 0) === 0;
	}

	// ---- Chartes CRUD ----

	saveCharte(c: Charte): void {
		const { name, ...rest } = c;
		this.stmtCharteUpsert.run(name, JSON.stringify(rest));
	}

	loadAllChartes(): Charte[] {
		// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
		const rows = this.stmtCharteSelectAll.all() as any[];
		return rows.map((row) => ({ name: row.name, ...JSON.parse(row.data) }));
	}

	loadCharte(name: string): Charte | null {
		// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
		const row = this.stmtCharteSelectOne.get(name) as any;
		if (!row) return null;
		return { name: row.name, ...JSON.parse(row.data) };
	}

	deleteCharte(name: string): boolean {
		const result = this.stmtCharteDelete.run(name);
		return result.changes > 0;
	}

	// ---- Assets CRUD ----

	saveAsset(a: AssetInput): void {
		this.stmtAssetUpsert.run({
			filename: a.filename,
			title: a.title || null,
			description: a.description || null,
			category: a.category || null,
			tags: typeof a.tags === "string" ? a.tags : JSON.stringify(a.tags || []),
			credit: a.credit || null,
			width: a.width || null,
			height: a.height || null,
			orientation: a.orientation || null,
		});
	}

	loadAllAssets(): AssetRow[] {
		// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
		return (this.stmtAssetSelectAll.all() as any[]).map((row) => ({
			...row,
			tags: JSON.parse(row.tags || "[]"),
		}));
	}

	loadAsset(filename: string): AssetRow | null {
		// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
		const row = this.stmtAssetSelectOne.get({ filename }) as any;
		if (!row) return null;
		return { ...row, tags: JSON.parse(row.tags || "[]") };
	}

	deleteAsset(filename: string): boolean {
		const result = this.stmtAssetDelete.run({ filename });
		return result.changes > 0;
	}

	// ---- Lifecycle ----

	close(): void {
		this.db.close();
	}

	// ---- Private helpers ----

	// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
	private rowToDoc(row: any): Document {
		const pageRows = this.stmtPageSelectByDoc.all({
			doc_name: row.name,
			// biome-ignore lint/suspicious/noExplicitAny: sqlite row shape is loose
		}) as any[];
		const pages: Page[] = pageRows.map((pr) => ({
			name: pr.name,
			html: pr.html || undefined,
			elements: JSON.parse(pr.elements || "[]"),
			canvas: pr.canvas ? JSON.parse(pr.canvas) : undefined,
		}));
		if (pages.length === 0) {
			pages.push({ name: "Page 1", elements: [] });
		}
		return new DocumentModel({
			id: row.id || crypto.randomUUID(),
			name: row.name,
			category: row.category || "general",
			canvas: JSON.parse(row.canvas),
			meta: JSON.parse(row.meta) || {},
			pages,
			activePage: row.active_page || 0,
			nextId: row.next_id,
		});
	}
}

/** Factory — register with `asFunction(() => createSQLiteStore(dbPath)).singleton().disposer(s => s.close())`. */
export function createSQLiteStore(dbPath: string): Store {
	return new DocumentStore(dbPath);
}
