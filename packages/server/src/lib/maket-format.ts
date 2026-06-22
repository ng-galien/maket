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
import type { Collection } from "@maket/shared";
import JSZip from "jszip";
import type { Charte, Document } from "../types.js";

export const MAKET_BUNDLE_KIND = "maket-bundle";
export const MAKET_BUNDLE_EXT = ".maket";

/** Versions this server can read. Increment on format changes. */
const SUPPORTED_VERSIONS = new Set([1, 2]);

export interface BundleDocument {
	id?: string;
	name: string;
	category?: string;
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
	/** Empty for v1 bundles (they don't carry assets). */
	assets: BundleAsset[];
}

/** Strip runtime-only fields so the snapshot round-trips cleanly. */
export function snapshotDocument(doc: Document): BundleDocument {
	const { canvas, meta, pages, activePage, nextId, id, name, category } = doc;
	return {
		id,
		name,
		category: category || "general",
		canvas,
		meta: meta ? { ...meta } : {},
		pages: pages.map((p) => ({
			id: p.id,
			name: p.name,
			elements: p.elements,
			html: p.html,
			canvas: p.canvas,
			collection: p.collection,
		})),
		activePage,
		nextId,
	};
}

// ── v1 (legacy gzip-JSON) ────────────────────────────────────────────────────

function buildManifest(
	documents: Document[],
	chartes: Charte[],
	collections: Collection[],
	version: number,
) {
	return {
		version,
		kind: MAKET_BUNDLE_KIND,
		exportedAt: new Date().toISOString(),
		documents: documents.map(snapshotDocument),
		chartes,
		collections,
	};
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
): Promise<Buffer> {
	const collections = assetsArg ? (collectionsOrAssets as Collection[]) : [];
	const assets = assetsArg ?? (collectionsOrAssets as BundleAsset[]);
	const zip = new JSZip();
	zip.file(
		"manifest.json",
		`${JSON.stringify(buildManifest(documents, chartes, collections, 2), null, 2)}\n`,
	);
	for (const a of assets) {
		zip.file(`assets/${a.relPath}`, a.bytes);
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
function isSafeAssetEntry(entryPath: string): boolean {
	if (!entryPath.startsWith("assets/")) return false;
	const rel = entryPath.slice("assets/".length);
	if (rel.length === 0) return false;
	if (rel.includes("..")) return false;
	if (rel.includes("/") || rel.includes("\\")) return false;
	return true;
}

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

function parseManifest(json: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error("Invalid .maket file: JSON parse failed");
	}
	if (!parsed || typeof parsed !== "object")
		throw new Error("Invalid .maket file: manifest is not an object");
	return parsed as Record<string, unknown>;
}

function finalizeManifest(
	m: Record<string, unknown>,
	assets: BundleAsset[],
): DecodedBundle {
	if (m.kind !== MAKET_BUNDLE_KIND)
		throw new Error(
			`Invalid .maket file: kind="${String(m.kind)}" (expected "${MAKET_BUNDLE_KIND}")`,
		);
	const version = typeof m.version === "number" ? m.version : NaN;
	if (!SUPPORTED_VERSIONS.has(version))
		throw new Error(
			`Unsupported .maket bundle version ${m.version} (this server handles ${[...SUPPORTED_VERSIONS].join(", ")})`,
		);
	if (!Array.isArray(m.documents))
		throw new Error("Invalid .maket file: missing documents[]");

	return {
		version,
		kind: MAKET_BUNDLE_KIND,
		exportedAt: typeof m.exportedAt === "string" ? m.exportedAt : "",
		documents: m.documents as BundleDocument[],
		chartes: Array.isArray(m.chartes) ? (m.chartes as Charte[]) : [],
		collections: Array.isArray(m.collections)
			? (m.collections as Collection[])
			: [],
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
	if (buf[0] === 0x1f && buf[1] === 0x8b) return decodeV1(buf);
	if (
		buf[0] === 0x50 &&
		buf[1] === 0x4b &&
		buf[2] === 0x03 &&
		buf[3] === 0x04
	) {
		return decodeV2(buf);
	}
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
