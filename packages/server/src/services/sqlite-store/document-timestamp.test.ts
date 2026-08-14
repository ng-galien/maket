import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDocument } from "../../types.js";
import { createDocumentRepository } from "./document-repository.js";
import { createDocumentStateRepository } from "./document-state-repository.js";
import { initializeSQLiteSchema } from "./schema.js";

const STATE_SCHEMA = {
	type: "object" as const,
	properties: { title: { type: "string" as const } },
	required: ["title"],
};

describe("document render timestamps", () => {
	it("advance across every mutation from a legacy second-resolution value", () => {
		const db = new DatabaseSync(":memory:");
		initializeSQLiteSchema(db);
		const documents = createDocumentRepository(db);
		const states = createDocumentStateRepository(db);
		const doc = createDocument({
			name: "legacy timestamp",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
		});
		documents.saveDoc(doc);
		db.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(
			"2999-01-01 00:00:00",
			doc.id,
		);

		const timestamps = [readTimestamp(db, doc.id)];
		documents.saveDoc(doc);
		timestamps.push(readTimestamp(db, doc.id));
		documents.renameDoc(doc.name, "renamed timestamp");
		timestamps.push(readTimestamp(db, doc.id));
		states.initializeDocumentState(doc.id, STATE_SCHEMA, { title: "One" });
		timestamps.push(readTimestamp(db, doc.id));
		states.appendDocumentStateRevision(doc.id, 1, { title: "Two" });
		timestamps.push(readTimestamp(db, doc.id));
		states.replaceDocumentStateSchema(doc.id, 2, STATE_SCHEMA, {
			title: "Three",
		});
		timestamps.push(readTimestamp(db, doc.id));

		expect(timestamps).toEqual([
			"2999-01-01 00:00:00",
			"2999-01-01 00:00:00.001",
			"2999-01-01 00:00:00.002",
			"2999-01-01 00:00:00.003",
			"2999-01-01 00:00:00.004",
			"2999-01-01 00:00:00.005",
		]);
		db.close();
	});
});

function readTimestamp(db: DatabaseSync, documentId: string): string {
	const row = db
		.prepare("SELECT updated_at FROM documents WHERE id = ?")
		.get(documentId) as { updated_at: string } | undefined;
	if (!row) throw new Error(`Document ${documentId} is missing.`);
	return row.updated_at;
}
