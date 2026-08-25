import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createCollectionCursorRepository } from "./collection-cursor-repository.js";
import { initializeSQLiteSchema } from "./schema.js";

describe("CollectionCursorRepository", () => {
	it("persists page-scoped render state and follows document deletion", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys = ON;");
		initializeSQLiteSchema(db);
		db.prepare("INSERT INTO documents (name, id, canvas) VALUES (?, ?, ?)").run(
			"poster",
			"doc-1",
			"{}",
		);
		const cursors = createCollectionCursorRepository(db);

		cursors.saveCollectionCursor({
			documentId: "doc-1",
			pageId: "page-1",
			collection: "clients",
			mode: "all",
			memberId: "member-2",
		});
		expect(cursors.loadAllCollectionCursors()).toEqual([
			{
				documentId: "doc-1",
				pageId: "page-1",
				collection: "clients",
				mode: "all",
				memberId: "member-2",
			},
		]);

		cursors.saveCollectionCursor({
			documentId: "doc-1",
			pageId: "page-1",
			collection: "clients",
			mode: "rendered",
			memberId: "member-1",
		});
		expect(cursors.loadAllCollectionCursors()[0]).toMatchObject({
			mode: "rendered",
			memberId: "member-1",
		});

		db.prepare("DELETE FROM documents WHERE id = ?").run("doc-1");
		expect(cursors.loadAllCollectionCursors()).toEqual([]);
		db.close();
	});
});
