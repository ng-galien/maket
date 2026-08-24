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
	saveAssets(assets: AssetInput[]): void;
	loadAllAssets(): AssetRow[];
	loadAsset(filename: string): AssetRow | null;
	deleteAsset(filename: string): boolean;
}

export function createAssetRepository(db: DatabaseSync): AssetRepository {
	const statements = prepareAssetStatements(db);
	const saveAsset = (asset: AssetInput) => {
		const tagsSet = asset.tags !== undefined ? 1 : 0;
		const tagsValue =
			typeof asset.tags === "string"
				? asset.tags
				: JSON.stringify(asset.tags ?? []);
		statements.assetUpsert.run({
			filename: asset.filename,
			title: asset.title ?? null,
			description: asset.description ?? null,
			category: asset.category ?? null,
			tags: tagsValue,
			tags_set: tagsSet,
			credit: asset.credit ?? null,
			width: asset.width ?? null,
			height: asset.height ?? null,
			orientation: asset.orientation ?? null,
		});
	};

	return {
		saveAsset(a) {
			saveAsset(a);
		},
		saveAssets(assets) {
			db.exec("BEGIN");
			try {
				for (const asset of assets) saveAsset(asset);
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
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
