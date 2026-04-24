/**
 * Scan rendered documents for `/assets/<filename>` references and pull the
 * matching binaries off disk so `.maket` v2 bundles can ship them alongside
 * the manifest.
 *
 * Best-effort: missing files are reported back in the `missing[]` list so
 * the caller can surface a clear message without failing the whole export.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Document } from "../types.js";
import type { BundleAsset } from "./maket-format.js";

// Matches `/assets/<filename>` in any attribute or url() — the single form
// we emit via `normalizeImageSrc`. Deliberately scoped to the image
// extensions the rest of the pipeline accepts (jpeg/png/webp/svg/gif).
const ASSET_REF = /\/assets\/([\w.\-()% ]+\.(?:jpe?g|png|webp|svg|gif))/gi;

export interface CollectAssetsResult {
	assets: BundleAsset[];
	missing: string[];
}

export function collectAssetFilenames(docs: Document[]): string[] {
	const set = new Set<string>();
	for (const doc of docs) {
		for (const page of doc.pages ?? []) {
			if (!page.html) continue;
			for (const m of page.html.matchAll(ASSET_REF)) {
				if (m[1]) set.add(m[1]);
			}
		}
	}
	return [...set];
}

export function loadAssetsFromDir(
	filenames: string[],
	assetsDir: string,
): CollectAssetsResult {
	const assets: BundleAsset[] = [];
	const missing: string[] = [];
	for (const name of filenames) {
		// Defensive: the regex already rules out separators, but a malformed
		// HTML ref could slip through. `basename` pins us to a flat name.
		const flat = basename(name);
		if (flat !== name) {
			missing.push(name);
			continue;
		}
		const abs = join(assetsDir, flat);
		if (!existsSync(abs)) {
			missing.push(name);
			continue;
		}
		try {
			assets.push({ relPath: flat, bytes: readFileSync(abs) });
		} catch {
			missing.push(name);
		}
	}
	return { assets, missing };
}
