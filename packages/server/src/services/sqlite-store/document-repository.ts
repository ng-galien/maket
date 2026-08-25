import crypto from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Document, Page } from "../../types.js";
import { createDocument } from "../../types.js";
import {
	DOCUMENT_NOW_SQL,
	NEXT_DOCUMENT_UPDATED_AT_SQL,
} from "./document-timestamp.js";

const DOC_UPSERT_SQL = `
  INSERT INTO documents (name, id, category, data_model, canvas, meta, active_page, next_id, created_at, updated_at)
  VALUES ($name, $id, $category, $data_model, $canvas, $meta, $active_page, $next_id, ${DOCUMENT_NOW_SQL}, ${DOCUMENT_NOW_SQL})
  ON CONFLICT(name) DO UPDATE SET
    id          = coalesce(excluded.id, documents.id),
    category    = excluded.category,
    data_model  = excluded.data_model,
    canvas      = excluded.canvas,
    meta        = excluded.meta,
    active_page = excluded.active_page,
    next_id     = excluded.next_id,
    updated_at  = ${NEXT_DOCUMENT_UPDATED_AT_SQL}
`;

const PAGE_UPSERT_SQL = `
  INSERT INTO pages (doc_name, idx, id, name, html, elements, canvas, collection)
  VALUES ($doc_name, $idx, $id, $name, $html, $elements, $canvas, $collection)
  ON CONFLICT(doc_name, idx) DO UPDATE SET
    id         = coalesce(excluded.id, pages.id),
    name       = excluded.name,
    html       = excluded.html,
    elements   = excluded.elements,
    canvas     = excluded.canvas,
    collection = excluded.collection
`;

export interface DocumentRepository {
	saveDoc(d: Document): void;
	saveDocs(docs: Document[]): void;
	loadAll(): Document[];
	loadOne(name: string): Document | null;
	loadById(id: string): Document | null;
	renameDoc(name: string, newName: string): void;
	deleteDoc(name: string): void;
	isEmpty(): boolean;
	listTimestamps(): Map<string, string>;
}

export function createDocumentRepository(db: DatabaseSync): DocumentRepository {
	const statements = prepareDocumentStatements(db);

	function saveDocInner(d: Document): void {
		statements.docUpsert.run({
			name: d.name,
			id: d.id,
			category: d.category || "general",
			data_model: d.dataModel,
			canvas: JSON.stringify(d.canvas),
			meta: JSON.stringify(d.meta || {}),
			active_page: d.activePage,
			next_id: d.nextId,
		});
		statements.pageDeleteByDoc.run({ doc_name: d.name });
		for (let i = 0; i < d.pages.length; i++) {
			const p = d.pages[i];
			if (!p) continue;
			statements.pageUpsert.run({
				doc_name: d.name,
				idx: i,
				id: p.id,
				name: p.name || `Page ${i + 1}`,
				html: p.html || null,
				elements: JSON.stringify(p.elements || []),
				canvas: p.canvas ? JSON.stringify(p.canvas) : null,
				collection: p.collection?.name ?? null,
			});
		}
	}

	return {
		saveDoc(d) {
			db.exec("BEGIN");
			try {
				saveDocInner(d);
				db.exec("COMMIT");
			} catch (e) {
				db.exec("ROLLBACK");
				throw e;
			}
		},
		saveDocs(docs) {
			db.exec("BEGIN");
			try {
				for (const d of docs) saveDocInner(d);
				db.exec("COMMIT");
			} catch (e) {
				db.exec("ROLLBACK");
				throw e;
			}
		},
		loadAll() {
			const rows = statements.docSelectAll.all() as any[];
			return rows.map((row) => rowToDoc(row, statements.pageSelectByDoc));
		},
		loadOne(name) {
			const row = statements.docSelectOne.get({ name }) as any;
			if (!row) return null;
			return rowToDoc(row, statements.pageSelectByDoc);
		},
		loadById(id) {
			const row = db
				.prepare("SELECT * FROM documents WHERE id = ?")
				.get(id) as any;
			if (!row) return null;
			return rowToDoc(row, statements.pageSelectByDoc);
		},
		renameDoc(name, newName) {
			db.exec("BEGIN");
			try {
				db.exec("PRAGMA defer_foreign_keys = ON");
				statements.docRename.run({ name, new_name: newName });
				statements.pageRenameDoc.run({ name, new_name: newName });
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
		deleteDoc(name) {
			statements.docDelete.run({ name });
		},
		isEmpty() {
			const row = db
				.prepare("SELECT COUNT(*) as cnt FROM documents")
				.get() as any;
			return (row?.cnt ?? 0) === 0;
		},
		listTimestamps() {
			const rows = db
				.prepare("SELECT name, updated_at FROM documents")
				.all() as Array<{
				name: string;
				updated_at: string;
			}>;
			const map = new Map<string, string>();
			for (const row of rows) map.set(row.name, row.updated_at);
			return map;
		},
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// SQLite repository setup owns the prepared-statement catalog for this persistence adapter.
function prepareDocumentStatements(db: DatabaseSync): {
	docUpsert: StatementSync;
	docSelectAll: StatementSync;
	docSelectOne: StatementSync;
	docDelete: StatementSync;
	docRename: StatementSync;
	pageUpsert: StatementSync;
	pageDeleteByDoc: StatementSync;
	pageRenameDoc: StatementSync;
	pageSelectByDoc: StatementSync;
} {
	return {
		docUpsert: db.prepare(DOC_UPSERT_SQL),
		docSelectAll: db.prepare("SELECT * FROM documents ORDER BY updated_at ASC"),
		docSelectOne: db.prepare("SELECT * FROM documents WHERE name = $name"),
		docDelete: db.prepare("DELETE FROM documents WHERE name = $name"),
		docRename: db.prepare(
			`UPDATE documents SET name = $new_name, updated_at = ${NEXT_DOCUMENT_UPDATED_AT_SQL} WHERE name = $name`,
		),
		pageUpsert: db.prepare(PAGE_UPSERT_SQL),
		pageDeleteByDoc: db.prepare("DELETE FROM pages WHERE doc_name = $doc_name"),
		pageRenameDoc: db.prepare(
			"UPDATE pages SET doc_name = $new_name WHERE doc_name = $name",
		),
		pageSelectByDoc: db.prepare(
			"SELECT * FROM pages WHERE doc_name = $doc_name ORDER BY idx ASC",
		),
	};
}

function rowToDoc(row: any, pageSelectByDoc: StatementSync): Document {
	const pageRows = pageSelectByDoc.all({ doc_name: row.name }) as any[];
	const pages: Page[] = pageRows.map((pr) => ({
		id: pr.id || crypto.randomUUID(),
		name: pr.name,
		html: pr.html || undefined,
		elements: JSON.parse(pr.elements || "[]"),
		canvas: pr.canvas ? JSON.parse(pr.canvas) : undefined,
		collection: pr.collection ? { name: pr.collection } : undefined,
	}));
	if (pages.length === 0) {
		pages.push({ id: crypto.randomUUID(), name: "Page 1", elements: [] });
	}
	return createDocument({
		id: row.id || crypto.randomUUID(),
		name: row.name,
		category: row.category || "general",
		dataModel: row.data_model || "static",
		canvas: JSON.parse(row.canvas),
		meta: JSON.parse(row.meta) || {},
		pages,
		activePage: row.active_page || 0,
		nextId: row.next_id,
	});
}
