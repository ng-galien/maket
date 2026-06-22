import type { DatabaseSync, StatementSync } from "node:sqlite";

const ASSET_UPSERT_SQL = `
  INSERT INTO assets (filename, title, description, category, tags, credit, width, height, orientation, created_at)
  VALUES ($filename, $title, $description, $category, $tags, $credit, $width, $height, $orientation, datetime('now'))
  ON CONFLICT(filename) DO UPDATE SET
    title = coalesce(excluded.title, assets.title),
    description = coalesce(excluded.description, assets.description),
    category = coalesce(excluded.category, assets.category),
    tags = CASE WHEN $tags_set = 1 THEN excluded.tags ELSE assets.tags END,
    credit = coalesce(excluded.credit, assets.credit),
    width = coalesce(excluded.width, assets.width),
    height = coalesce(excluded.height, assets.height),
    orientation = coalesce(excluded.orientation, assets.orientation)
`;

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

export interface AssetRepository {
	saveAsset(a: AssetInput): void;
	loadAllAssets(): AssetRow[];
	loadAsset(filename: string): AssetRow | null;
	deleteAsset(filename: string): boolean;
}

export function createAssetRepository(db: DatabaseSync): AssetRepository {
	const statements = prepareAssetStatements(db);

	return {
		saveAsset(a) {
			const tagsSet = a.tags !== undefined ? 1 : 0;
			const tagsValue =
				typeof a.tags === "string" ? a.tags : JSON.stringify(a.tags ?? []);
			statements.assetUpsert.run({
				filename: a.filename,
				title: a.title ?? null,
				description: a.description ?? null,
				category: a.category ?? null,
				tags: tagsValue,
				tags_set: tagsSet,
				credit: a.credit ?? null,
				width: a.width ?? null,
				height: a.height ?? null,
				orientation: a.orientation ?? null,
			});
		},
		loadAllAssets() {
			return (statements.assetSelectAll.all() as any[]).map(assetFromStorage);
		},
		loadAsset(filename) {
			const row = statements.assetSelectOne.get({ filename }) as any;
			if (!row) return null;
			return assetFromStorage(row);
		},
		deleteAsset(filename) {
			const result = statements.assetDelete.run({ filename });
			return result.changes > 0;
		},
	};
}

function prepareAssetStatements(db: DatabaseSync): {
	assetUpsert: StatementSync;
	assetSelectAll: StatementSync;
	assetSelectOne: StatementSync;
	assetDelete: StatementSync;
} {
	return {
		assetUpsert: db.prepare(ASSET_UPSERT_SQL),
		assetSelectAll: db.prepare("SELECT * FROM assets ORDER BY created_at DESC"),
		assetSelectOne: db.prepare(
			"SELECT * FROM assets WHERE filename = $filename",
		),
		assetDelete: db.prepare("DELETE FROM assets WHERE filename = $filename"),
	};
}

function assetFromStorage(row: any): AssetRow {
	return { ...row, tags: JSON.parse(row.tags || "[]") };
}
