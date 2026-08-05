import { DatabaseSync } from "node:sqlite";
import type { AssetRepository } from "./sqlite-store/asset-repository.js";
import {
	type AssetInput,
	type AssetRow,
	createAssetRepository,
} from "./sqlite-store/asset-repository.js";
import type { CharteRepository } from "./sqlite-store/charte-repository.js";
import { createCharteRepository } from "./sqlite-store/charte-repository.js";
import type { CollectionRepository } from "./sqlite-store/collection-repository.js";
import { createCollectionRepository } from "./sqlite-store/collection-repository.js";
import type { DocumentRepository } from "./sqlite-store/document-repository.js";
import { createDocumentRepository } from "./sqlite-store/document-repository.js";
import type { DocumentStateRepository } from "./sqlite-store/document-state-repository.js";
import { createDocumentStateRepository } from "./sqlite-store/document-state-repository.js";
import { initializeSQLiteSchema } from "./sqlite-store/schema.js";

export type { AssetInput, AssetRow };

export interface Store
	extends DocumentRepository,
		CharteRepository,
		CollectionRepository,
		DocumentStateRepository,
		AssetRepository {
	close(): void;
}

// code-moniker: ignore[smell-feature-envy-local]
// Store composition intentionally assembles every focused SQLite repository.
export function createSQLiteStore(dbPath: string): Store {
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	initializeSQLiteSchema(db);

	return {
		...createDocumentRepository(db),
		...createCharteRepository(db),
		...createCollectionRepository(db),
		...createDocumentStateRepository(db),
		...createAssetRepository(db),
		close() {
			db.close();
		},
	};
}
