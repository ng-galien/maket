/**
 * .maket bundle format — two on-disk layouts share the same extension and are
 * distinguished by magic bytes.
 *
 *   v1 (legacy): single gzipped JSON file. Structure only — no asset binaries.
 *                Kept for back-compat so older bundles import without error.
 *   v2 (current): ZIP container with `manifest.json` + `assets/*`. Portable
 *                 across machines; the common "share this doc" / "archive for
 *                 later" use cases actually work.
 *
 * `decodeBundle` sniffs the first four bytes: `1f 8b` → v1 gunzip path,
 * `50 4b 03 04` → v2 ZIP path. Anything else is rejected up front.
 *
 * Runtime-only document fields (`_layout`, `_displayed`) are stripped on the
 * way out — we pick the fields we want instead of blindly serializing the
 * whole doc. Chartes are auto-collected from `doc.meta.charte` so an import
 * on a clean install restores the same look without extra steps.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import {
	type BundleDocumentStateSnapshot,
	buildBundleManifest,
	type Collection,
	isGzipMagic,
	isSafeAssetEntry as isSafeAssetEntryShared,
	isZipMagic,
	parseBundleManifest,
	MAKET_BUNDLE_EXT as SHARED_BUNDLE_EXT,
	MAKET_BUNDLE_KIND as SHARED_BUNDLE_KIND,
	snapshotBundleDocument,
	validateBundleManifest,
} from "@maket/shared";
import JSZip from "jszip";
import type { Charte, Document } from "../types.js";

export const MAKET_BUNDLE_KIND = SHARED_BUNDLE_KIND;
export const MAKET_BUNDLE_EXT = SHARED_BUNDLE_EXT;

export interface BundleDocument {
	id?: string;
	name: string;
	category?: string;
	dataModel?: Document["dataModel"];
	canvas: Document["canvas"];
	meta?: Document["meta"];
	pages: Document["pages"];
	activePage?: number;
	nextId?: number;
}

/** Single asset file carried alongside the manifest in a v2 bundle. */
export interface BundleAsset {
	/** Flat filename under `assets/`, e.g. `logo.png`. Never a nested path. */
	relPath: string;
	bytes: Buffer;
}

export interface DecodedBundle {
	version: number;
	kind: typeof MAKET_BUNDLE_KIND;
	exportedAt: string;
	documents: BundleDocument[];
	chartes: Charte[];
	collections: Collection[];
	documentStates: BundleDocumentStateSnapshot[];
	/** Empty for v1 bundles (they don't carry assets). */
	assets: BundleAsset[];
}

export interface EncodeBundleOptions {
	exportedAt?: string;
	entryDate?: Date;
	documentStates?: BundleDocumentStateSnapshot[];
}

/** Strip runtime-only fields so the snapshot round-trips cleanly. Field
 * picking lives in @maket/shared (snapshotBundleDocument via buildManifest)
 * so browser encoders share the exact wire shape. */
export function snapshotDocument(doc: Document): BundleDocument {
	return snapshotBundleDocument(doc) as unknown as BundleDocument;
}

// ── v1 (legacy gzip-JSON) ────────────────────────────────────────────────────

function buildManifest(
	documents: Document[],
	chartes: Charte[],
	collections: Collection[],
	version: number,
	exportedAt = new Date().toISOString(),
	documentStates: BundleDocumentStateSnapshot[] = [],
) {
	return buildBundleManifest(documents, chartes, collections, {
		version,
		exportedAt,
		documentStates,
	}) as { documents: unknown[] };
}

/** v1 encoder — kept exported for deliberate "structure-only" exports. */
export function encodeBundleV1(
	documents: Document[],
	chartes: Charte[],
): Buffer {
	return gzipSync(
		Buffer.from(
			JSON.stringify(buildManifest(documents, chartes, [], 1)),
			"utf-8",
		),
	);
}

function decodeV1(buf: Buffer): DecodedBundle {
	let json: string;
	try {
		json = gunzipSync(buf).toString("utf-8");
	} catch {
		throw new Error("Invalid .maket file: not a valid gzip stream");
	}
	return finalizeManifest(parseManifest(json), []);
}

// ── v2 (ZIP with assets) ─────────────────────────────────────────────────────

/**
 * v2 encoder. `assets` may be empty — in that case the ZIP still has
 * `manifest.json` and an empty `assets/` section, which is valid and lighter
 * than a "v1 but wrapped" workaround.
 */
export async function encodeBundleV2(
	documents: Document[],
	chartes: Charte[],
	collectionsOrAssets: Collection[] | BundleAsset[],
	assetsArg?: BundleAsset[],
	options: EncodeBundleOptions = {},
): Promise<Buffer> {
	const collections = assetsArg ? (collectionsOrAssets as Collection[]) : [];
	const assets = assetsArg ?? (collectionsOrAssets as BundleAsset[]);
	const zip = new JSZip();
	const entryOptions = options.entryDate
		? { createFolders: false, date: options.entryDate }
		: undefined;
	zip.file(
		"manifest.json",
		`${JSON.stringify(
			buildManifest(
				documents,
				chartes,
				collections,
				2,
				options.exportedAt,
				options.documentStates,
			),
			null,
			2,
		)}\n`,
		entryOptions,
	);
	for (const a of assets) {
		zip.file(`assets/${a.relPath}`, a.bytes, entryOptions);
	}
	return zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
	});
}

/**
 * Entries whose name contains `..`, path separators, or resolves outside
 * `assets/` are dropped. Flat filenames are what `normalizeImageSrc` /
 * `ASSETS_DIR` expect, so anything else is suspect and never useful.
 */
const isSafeAssetEntry = isSafeAssetEntryShared;

async function decodeV2(buf: Buffer): Promise<DecodedBundle> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(buf);
	} catch {
		throw new Error("Invalid .maket file: not a valid ZIP container");
	}

	const manifestFile = zip.file("manifest.json");
	if (!manifestFile) {
		throw new Error("Invalid .maket v2: missing manifest.json");
	}
	const manifestText = await manifestFile.async("string");

	const assets: BundleAsset[] = [];
	for (const [entryPath, entry] of Object.entries(zip.files)) {
		if (entry.dir) continue;
		if (!entryPath.startsWith("assets/")) continue;
		if (!isSafeAssetEntry(entryPath)) continue;
		const relPath = entryPath.slice("assets/".length);
		const bytes = await entry.async("nodebuffer");
		assets.push({ relPath, bytes });
	}

	return finalizeManifest(parseManifest(manifestText), assets);
}

// ── Shared manifest validation ───────────────────────────────────────────────

const parseManifest = parseBundleManifest;

function finalizeManifest(
	m: Record<string, unknown>,
	assets: BundleAsset[],
): DecodedBundle {
	const data = validateBundleManifest(m);
	return {
		version: data.version,
		kind: MAKET_BUNDLE_KIND,
		exportedAt: data.exportedAt,
		documents: data.documents as BundleDocument[],
		chartes: data.chartes as Charte[],
		collections: data.collections as Collection[],
		documentStates: data.documentStates,
		assets,
	};
}

// ── Public facade ────────────────────────────────────────────────────────────

/**
 * Parse a bundle of either format. v1 (`1f 8b` gzip) returns with empty
 * `assets[]`; v2 (`50 4b 03 04` ZIP) returns with any packed binaries.
 */
export async function decodeBundle(buf: Buffer): Promise<DecodedBundle> {
	if (buf.length < 4) {
		throw new Error("Invalid .maket file: too small");
	}
	if (isGzipMagic(buf)) return decodeV1(buf);
	if (isZipMagic(buf)) return decodeV2(buf);
	throw new Error(
		`Invalid .maket file: unknown magic bytes ${buf.subarray(0, 4).toString("hex")} (expected gzip 1f8b or zip 504b0304)`,
	);
}

// ── Filename helpers ─────────────────────────────────────────────────────────

/** Default filename for a bundle. Safe across filesystems. */
export function bundleFilename(source: string | undefined): string {
	const base = (source || "maket-bundle")
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.slice(0, 80);
	return `${base || "maket-bundle"}${MAKET_BUNDLE_EXT}`;
}

/** Generate a unique name for an incoming doc, suffixing if needed. */
export function uniqueName(
	wanted: string,
	taken: (name: string) => boolean,
): string {
	if (!taken(wanted)) return wanted;
	const imported = `${wanted} (imported)`;
	if (!taken(imported)) return imported;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${wanted} (imported ${i})`;
		if (!taken(candidate)) return candidate;
	}
	return `${wanted} (imported ${Date.now()})`;
}
