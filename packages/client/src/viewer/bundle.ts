/**
 * Browser-side `.maket` bundle decoder for the standalone viewer.
 *
 * Mirrors the server's `maket-format.ts` sniffing: `1f 8b` → v1 gzip JSON
 * (decompressed natively via DecompressionStream, no assets), `50 4b 03 04` →
 * v2 ZIP with `manifest.json` + `assets/*`. Asset binaries become object URLs
 * so nothing ever leaves the browser.
 */

import type { Collection } from "@maket/shared";
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

function isZip(bytes: Uint8Array): boolean {
	return (
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}

function isGzip(bytes: Uint8Array): boolean {
	return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Same guard as the server: flat filenames under assets/ only. */
function isSafeAssetEntry(entryPath: string): boolean {
	if (!entryPath.startsWith("assets/")) return false;
	const rel = entryPath.slice("assets/".length);
	if (rel.length === 0) return false;
	if (rel.includes("..")) return false;
	if (rel.includes("/") || rel.includes("\\")) return false;
	return true;
}

async function gunzipText(data: ArrayBuffer): Promise<string> {
	const stream = new Blob([data])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	return new Response(stream).text();
}

function parseManifest(json: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error("Invalid .maket file: manifest is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Invalid .maket file: manifest is not an object");
	}
	const manifest = parsed as Record<string, unknown>;
	if (manifest.kind !== "maket-bundle") {
		throw new Error("Invalid .maket file: not a maket bundle");
	}
	if (!Array.isArray(manifest.documents)) {
		throw new Error("Invalid .maket file: missing documents");
	}
	return manifest;
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
	const documents = (manifest.documents as Record<string, unknown>[]).map(
		toViewerDocument,
	);
	if (documents.length === 0) {
		throw new Error("This .maket file contains no documents");
	}
	return {
		version: typeof manifest.version === "number" ? manifest.version : 0,
		exportedAt:
			typeof manifest.exportedAt === "string" ? manifest.exportedAt : undefined,
		documents,
		chartes: Array.isArray(manifest.chartes)
			? (manifest.chartes as ViewerCharte[])
			: [],
		collections: Array.isArray(manifest.collections)
			? (manifest.collections as Collection[])
			: [],
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
	const manifest = parseManifest(await manifestFile.async("string"));

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
	if (isZip(bytes)) return decodeV2(data);
	if (isGzip(bytes)) {
		return finalizeManifest(parseManifest(await gunzipText(data)), new Map());
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
