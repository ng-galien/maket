/**
 * Write `.maket` v2 bundle assets back into the target datadir's ASSETS_DIR.
 *
 * Collision strategy: **skip if the target filename already exists**. The
 * imported doc's HTML refs (`/assets/<filename>`) are frozen; renaming an
 * incoming asset would break those refs, and overwriting a local file could
 * destroy unrelated work. Skipping is safe — either the user already has the
 * right bytes under that name, or they have a different asset sharing the
 * name and their local copy wins. We report the counts back so the caller
 * can surface a clear message.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BundleAsset } from "./maket-format.js";

export interface WriteAssetsResult {
	written: number;
	skipped: number;
	rejected: string[];
}

export function writeBundleAssets(
	assets: BundleAsset[],
	assetsDir: string,
): WriteAssetsResult {
	if (assets.length === 0) {
		return { written: 0, skipped: 0, rejected: [] };
	}
	mkdirSync(assetsDir, { recursive: true });

	let written = 0;
	let skipped = 0;
	const rejected: string[] = [];
	for (const a of assets) {
		// `decodeV2` already strips unsafe entries, but a second check here
		// keeps this module independently safe for callers that might pass
		// assets from another source.
		if (
			!a.relPath ||
			a.relPath.includes("..") ||
			a.relPath.includes("/") ||
			a.relPath.includes("\\")
		) {
			rejected.push(a.relPath);
			continue;
		}
		const target = join(assetsDir, a.relPath);
		if (existsSync(target)) {
			skipped++;
			continue;
		}
		writeFileSync(target, a.bytes);
		written++;
	}
	return { written, skipped, rejected };
}
