import type { DatabaseSync } from "node:sqlite";
import type { PendingMessage } from "@maket/shared";
import { MessageError } from "../../lib/message-error.js";

export interface AnnotationRepository {
	saveAnnotation(annotation: PendingMessage): void;
	loadAnnotations(): PendingMessage[];
	deleteAnnotations(ids: string[]): string[];
}

export function createAnnotationRepository(
	db: DatabaseSync,
): AnnotationRepository {
	const selectDocument = db.prepare(
		"SELECT id FROM documents WHERE name = $name",
	);
	const insert = db.prepare(`
		INSERT INTO annotations (
			id, document_id, page_index, element_id, type, text, file, position, ts
		) VALUES (
			$id, $document_id, $page_index, $element_id, $type, $text, $file, $position, $ts
		)
		ON CONFLICT(id) DO UPDATE SET
			document_id = excluded.document_id,
			page_index = excluded.page_index,
			element_id = excluded.element_id,
			type = excluded.type,
			text = excluded.text,
			file = excluded.file,
			position = excluded.position,
			ts = excluded.ts
	`);
	const selectAll = db.prepare(`
		SELECT a.id, d.name AS doc_name, a.page_index, a.element_id,
			a.type, a.text, a.file, a.position, a.ts
		FROM annotations a
		LEFT JOIN documents d ON d.id = a.document_id
		ORDER BY a.created_at ASC, a.id ASC
	`);
	const selectById = db.prepare("SELECT id FROM annotations WHERE id = ?");
	const deleteById = db.prepare("DELETE FROM annotations WHERE id = ?");

	return {
		saveAnnotation(annotation) {
			let documentId: string | null = null;
			if (annotation.docName) {
				const row = selectDocument.get({ name: annotation.docName }) as
					| { id: string }
					| undefined;
				if (!row)
					throw new MessageError(
						`Document "${annotation.docName}" not found.`,
						"msg_document_not_found",
						{ name: annotation.docName },
					);
				documentId = row.id;
			}
			insert.run({
				id: annotation.id,
				document_id: documentId,
				page_index: annotation.pageIndex ?? null,
				element_id: annotation.elementId ?? null,
				type: annotation.type ?? "note",
				text: annotation.text ?? null,
				file: annotation.file ?? null,
				position: annotation.position ?? null,
				ts: annotation.ts ?? Date.now(),
			});
		},
		loadAnnotations() {
			return (selectAll.all() as Array<Record<string, unknown>>).map((row) => ({
				id: String(row.id),
				...(row.doc_name ? { docName: String(row.doc_name) } : {}),
				...(row.page_index != null
					? { pageIndex: Number(row.page_index) }
					: {}),
				...(row.element_id ? { elementId: String(row.element_id) } : {}),
				type: String(row.type),
				...(row.text != null ? { text: String(row.text) } : {}),
				...(row.file != null ? { file: String(row.file) } : {}),
				...(row.position != null ? { position: String(row.position) } : {}),
				ts: Number(row.ts),
			}));
		},
		deleteAnnotations(ids) {
			const matched: string[] = [];
			db.exec("BEGIN");
			try {
				for (const id of ids) {
					if (!selectById.get(id)) continue;
					deleteById.run(id);
					matched.push(id);
				}
				db.exec("COMMIT");
				return matched;
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
	};
}
