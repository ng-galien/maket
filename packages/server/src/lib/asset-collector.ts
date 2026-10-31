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

/** File name candidates for an `/assets/` reference: the reference as
 * written, then its URL-decoded form (a name with `#`, `?` or `%` is
 * percent-encoded in a `src`). A decoded name with a path separator is
 * dropped. */
export function assetFileCandidates(reference: string): string[] {
	let decoded = reference;
	try {
		decoded = decodeURIComponent(reference);
	} catch {
		return [reference];
	}
	return decoded === reference || basename(decoded) !== decoded
		? [reference]
		: [reference, decoded];
}

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
		const flat = basename(name);
		if (flat !== name) {
			missing.push(name);
			continue;
		}
		const file = assetFileCandidates(flat).find((candidate) =>
			existsSync(join(assetsDir, candidate)),
		);
		if (!file) {
			missing.push(name);
			continue;
		}
		try {
			assets.push({
				relPath: file,
				bytes: readFileSync(join(assetsDir, file)),
			});
		} catch {
			missing.push(name);
		}
	}
	return { assets, missing };
}
