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
	type DocumentStateClientView,
	isGzipMagic,
	isSafeAssetEntry,
	isZipMagic,
	parseBundleManifest,
	validateBundleManifest,
} from "@maket/shared";
import JSZip from "jszip";
import { translate } from "../i18n/useT";
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
	documentStates: Record<string, DocumentStateClientView>;
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
	const requestedActivePage =
		typeof raw.activePage === "number" ? raw.activePage : 0;
	return {
		id: typeof raw.id === "string" ? raw.id : name,
		name,
		category: typeof raw.category === "string" ? raw.category : "general",
		dataModel:
			raw.dataModel === "collection" || raw.dataModel === "state"
				? raw.dataModel
				: "static",
		canvas: raw.canvas as Document["canvas"],
		pages: pages.map((p) => ({ elements: [], ...p })),
		activePage:
			Number.isInteger(requestedActivePage) &&
			requestedActivePage >= 0 &&
			requestedActivePage < pages.length
				? requestedActivePage
				: 0,
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
		throw new Error(translate("bundle_error_no_documents"));
	}
	return {
		version: data.version,
		exportedAt: data.exportedAt || undefined,
		documents,
		chartes: data.chartes as ViewerCharte[],
		collections: data.collections as Collection[],
		documentStates: Object.fromEntries(
			data.documentStates.map((snapshot) => {
				const index = (data.documents as Record<string, unknown>[]).findIndex(
					(doc) => doc.id === snapshot.documentId,
				);
				const document = documents[index];
				const raw = data.documents[index] as Record<string, unknown>;
				const pages = raw.pages as Record<string, unknown>[];
				const view: DocumentStateClientView = {
					schema: snapshot.schema,
					data: snapshot.data,
					revision: 1,
					createdAt: data.exportedAt,
					templates: Object.fromEntries(
						pages.flatMap((page) =>
							typeof page.id === "string" && typeof page.html === "string"
								? [[page.id, page.html]]
								: [],
						),
					),
				};
				return [document?.name ?? snapshot.documentId, view];
			}),
		),
		assetUrls,
	};
}

async function openBundleZip(data: ArrayBuffer): Promise<JSZip> {
	try {
		return await JSZip.loadAsync(data);
	} catch {
		throw new Error(translate("bundle_error_not_zip"));
	}
}

async function readZipManifest(zip: JSZip): Promise<Record<string, unknown>> {
	const manifestFile = zip.file("manifest.json");
	if (!manifestFile) {
		throw new Error(translate("bundle_error_missing_manifest"));
	}
	return parseBundleManifest(await manifestFile.async("string"));
}

async function populateAssetUrls(
	zip: JSZip,
	assetUrls: Map<string, string>,
): Promise<void> {
	for (const [entryPath, entry] of Object.entries(zip.files)) {
		if (entry.dir || !isSafeAssetEntry(entryPath)) continue;
		const relPath = entryPath.slice("assets/".length);
		const bytes = await entry.async("uint8array");
		const blob = new Blob([bytes as BlobPart], { type: assetMime(relPath) });
		assetUrls.set(relPath, URL.createObjectURL(blob));
	}
}

function revokeAssetUrls(assetUrls: Map<string, string>): void {
	for (const url of assetUrls.values()) URL.revokeObjectURL(url);
}

async function decodeV2(data: ArrayBuffer): Promise<ViewerWorkspace> {
	const zip = await openBundleZip(data);
	const manifest = await readZipManifest(zip);
	const assetUrls = new Map<string, string>();
	try {
		await populateAssetUrls(zip, assetUrls);
		return finalizeManifest(manifest, assetUrls);
	} catch (error) {
		revokeAssetUrls(assetUrls);
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
	throw new Error(translate("bundle_error_unrecognized"));
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
