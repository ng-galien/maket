/**
 * Browser-side `.maket` bundle decoder for the standalone viewer.
 *
 * Mirrors the server's `maket-format.ts` sniffing: `1f 8b` → v1 gzip JSON
 * (decompressed natively via DecompressionStream, no assets), `50 4b 03 04` →
 * v2 ZIP with `manifest.json` + `assets/*`. Asset binaries become object URLs
 * so nothing ever leaves the browser.
 */

import {
	type Collection,
	isGzipMagic,
	isSafeAssetEntry,
	isZipMagic,
	parseBundleManifest,
	validateBundleManifest,
} from "@maket/shared";
import JSZip from "jszip";
import type { Document } from "../store/types";

export interface ViewerCharte {
	name: string;
	css?: string;
}

export interface ViewerWorkspace {
	version: number;
	exportedAt?: string;
	documents: Document[];
	chartes: ViewerCharte[];
	collections: Collection[];
	/** Flat asset filename → object URL */
	assetUrls: Map<string, string>;
}

const ASSET_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
};

function assetMime(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	return ASSET_MIME[ext] ?? "application/octet-stream";
}

async function gunzipText(data: ArrayBuffer): Promise<string> {
	const stream = new Blob([data])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	return new Response(stream).text();
}

function toViewerDocument(raw: Record<string, unknown>): Document {
	const name = typeof raw.name === "string" ? raw.name : "untitled";
	const pages = Array.isArray(raw.pages) ? raw.pages : [];
	return {
		id: typeof raw.id === "string" ? raw.id : name,
		name,
		category: typeof raw.category === "string" ? raw.category : "general",
		canvas: raw.canvas as Document["canvas"],
		pages: pages.map((p) => ({ elements: [], ...p })),
		activePage: typeof raw.activePage === "number" ? raw.activePage : 0,
		meta: (raw.meta as Document["meta"]) ?? {},
	};
}

function finalizeManifest(
	manifest: Record<string, unknown>,
	assetUrls: Map<string, string>,
): ViewerWorkspace {
	const data = validateBundleManifest(manifest);
	const documents = (data.documents as Record<string, unknown>[]).map(
		toViewerDocument,
	);
	if (documents.length === 0) {
		throw new Error("This .maket file contains no documents");
	}
	return {
		version: data.version,
		exportedAt: data.exportedAt || undefined,
		documents,
		chartes: data.chartes as ViewerCharte[],
		collections: data.collections as Collection[],
		assetUrls,
	};
}

async function decodeV2(data: ArrayBuffer): Promise<ViewerWorkspace> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(data);
	} catch {
		throw new Error("Invalid .maket file: not a valid ZIP container");
	}
	const manifestFile = zip.file("manifest.json");
	if (!manifestFile) {
		throw new Error("Invalid .maket file: missing manifest.json");
	}
	const manifest = parseBundleManifest(await manifestFile.async("string"));

	// Revoke on any failure past this point — created object URLs would
	// otherwise leak for the tab's lifetime on every failed open.
	const assetUrls = new Map<string, string>();
	try {
		for (const [entryPath, entry] of Object.entries(zip.files)) {
			if (entry.dir || !isSafeAssetEntry(entryPath)) continue;
			const relPath = entryPath.slice("assets/".length);
			const bytes = await entry.async("uint8array");
			const blob = new Blob([bytes as BlobPart], { type: assetMime(relPath) });
			assetUrls.set(relPath, URL.createObjectURL(blob));
		}
		return finalizeManifest(manifest, assetUrls);
	} catch (error) {
		for (const url of assetUrls.values()) URL.revokeObjectURL(url);
		throw error;
	}
}

export async function decodeMaketFile(
	data: ArrayBuffer,
): Promise<ViewerWorkspace> {
	const bytes = new Uint8Array(data.slice(0, 4));
	if (isZipMagic(bytes)) return decodeV2(data);
	if (isGzipMagic(bytes)) {
		return finalizeManifest(
			parseBundleManifest(await gunzipText(data)),
			new Map(),
		);
	}
	throw new Error("Invalid .maket file: unrecognized format");
}

/**
 * Rewrite `/assets/<file>` references (plain src/href attributes and CSS
 * `url(...)`, including the `thumb|preview|print` variants) to the bundle's
 * object URLs. References to assets missing from the bundle are left as-is.
 */
export function rewriteAssetRefs(
	html: string,
	assetUrls: Map<string, string>,
): string {
	if (assetUrls.size === 0) return html;
	const resolve = (file: string): string | undefined =>
		assetUrls.get(safeDecode(file));
	return html
		.replace(
			/(src|href)=["']\/assets\/(?:(?:thumb|preview|print)\/)?([^"']+)["']/gi,
			(match, attr, file) => {
				const url = resolve(file);
				return url ? `${attr}="${url}"` : match;
			},
		)
		.replace(
			/url\(\s*(["']?)\/assets\/(?:(?:thumb|preview|print)\/)?([^"')]+)\1\s*\)/gi,
			(match, _quote, file) => {
				const url = resolve(file);
				return url ? `url("${url}")` : match;
			},
		);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
