import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Charte } from "../../types.js";

const CHARTE_UPSERT_SQL = `
  INSERT INTO chartes (name, data, created_at, updated_at)
  VALUES (?, ?, datetime('now'), datetime('now'))
  ON CONFLICT(name) DO UPDATE SET
    data       = excluded.data,
    updated_at = datetime('now')
`;

export interface CharteRepository {
	saveCharte(c: Charte): void;
	loadAllChartes(): Charte[];
	loadCharte(name: string): Charte | null;
	deleteCharte(name: string): boolean;
}

export function createCharteRepository(db: DatabaseSync): CharteRepository {
	const statements = prepareCharteStatements(db);

	return {
		saveCharte(c) {
			const { name, ...rest } = c;
			statements.charteUpsert.run(name, JSON.stringify(rest));
		},
		loadAllChartes() {
			const rows = statements.charteSelectAll.all() as any[];
			return rows.map((row) => ({ name: row.name, ...JSON.parse(row.data) }));
		},
		loadCharte(name) {
			const row = statements.charteSelectOne.get(name) as any;
			if (!row) return null;
			return { name: row.name, ...JSON.parse(row.data) };
		},
		deleteCharte(name) {
			const result = statements.charteDelete.run(name);
			return result.changes > 0;
		},
	};
}

function prepareCharteStatements(db: DatabaseSync): {
	charteUpsert: StatementSync;
	charteSelectAll: StatementSync;
	charteSelectOne: StatementSync;
	charteDelete: StatementSync;
} {
	return {
		charteUpsert: db.prepare(CHARTE_UPSERT_SQL),
		charteSelectAll: db.prepare("SELECT * FROM chartes ORDER BY name ASC"),
		charteSelectOne: db.prepare("SELECT * FROM chartes WHERE name = ?"),
		charteDelete: db.prepare("DELETE FROM chartes WHERE name = ?"),
	};
}
