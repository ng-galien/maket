import type { DatabaseSync } from "node:sqlite";
import type { CollectionCursorMode } from "@maket/shared";

export interface CollectionCursorRecord {
	documentId: string;
	pageId: string;
	collection: string;
	mode: CollectionCursorMode;
	memberId: string | null;
}

export interface CollectionCursorRepository {
	loadAllCollectionCursors(): CollectionCursorRecord[];
	saveCollectionCursor(cursor: CollectionCursorRecord): void;
	deleteCollectionCursor(documentId: string, pageId: string): void;
}

export function createCollectionCursorRepository(
	db: DatabaseSync,
): CollectionCursorRepository {
	const loadAll = db.prepare(`
		SELECT
			document_id AS documentId,
			page_id AS pageId,
			collection,
			mode,
			member_id AS memberId
		FROM collection_cursors
	`);
	const save = db.prepare(`
		INSERT INTO collection_cursors (
			document_id, page_id, collection, mode, member_id, updated_at
		) VALUES (
			$documentId, $pageId, $collection, $mode, $memberId,
			strftime('%Y-%m-%d %H:%M:%f', 'now')
		)
		ON CONFLICT(document_id, page_id) DO UPDATE SET
			collection = excluded.collection,
			mode = excluded.mode,
			member_id = excluded.member_id,
			updated_at = excluded.updated_at
	`);
	const remove = db.prepare(`
		DELETE FROM collection_cursors
		WHERE document_id = $documentId AND page_id = $pageId
	`);

	return {
		loadAllCollectionCursors() {
			return loadAll.all() as unknown as CollectionCursorRecord[];
		},
		saveCollectionCursor(cursor) {
			save.run({
				documentId: cursor.documentId,
				pageId: cursor.pageId,
				collection: cursor.collection,
				mode: cursor.mode,
				memberId: cursor.memberId,
			});
		},
		deleteCollectionCursor(documentId, pageId) {
			remove.run({ documentId, pageId });
		},
	};
}
