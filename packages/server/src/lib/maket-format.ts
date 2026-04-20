/**
 * .maket bundle format — gzipped JSON envelope carrying one or more documents
 * plus every charte they reference.
 *
 * Exported with `encodeBundle` → Buffer; consumed with `decodeBundle`.
 * Runtime-only document fields (`_layout`, `_displayed`) are stripped on the
 * way out — we pick the fields we want instead of blindly serializing the
 * whole doc. Chartes are auto-collected from `doc.meta.charte` so an import
 * on a clean install restores the same look without extra steps.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import type { Charte, Document } from "../types.js";

export const MAKET_BUNDLE_VERSION = 1;
export const MAKET_BUNDLE_KIND = "maket-bundle";
export const MAKET_BUNDLE_EXT = ".maket";

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

export interface MaketBundle {
	version: number;
	kind: typeof MAKET_BUNDLE_KIND;
	exportedAt: string;
	documents: BundleDocument[];
	chartes: Charte[];
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
			name: p.name,
			elements: p.elements,
			html: p.html,
			canvas: p.canvas,
		})),
		activePage,
		nextId,
	};
}

/** Produce a compressed bundle from the given documents + chartes. */
export function encodeBundle(documents: Document[], chartes: Charte[]): Buffer {
	const payload: MaketBundle = {
		version: MAKET_BUNDLE_VERSION,
		kind: MAKET_BUNDLE_KIND,
		exportedAt: new Date().toISOString(),
		documents: documents.map(snapshotDocument),
		chartes,
	};
	return gzipSync(Buffer.from(JSON.stringify(payload), "utf-8"));
}

/** Parse a compressed bundle. Throws on invalid gzip / JSON / shape. */
export function decodeBundle(buf: Buffer): MaketBundle {
	let json: string;
	try {
		json = gunzipSync(buf).toString("utf-8");
	} catch {
		throw new Error("Invalid .maket file: not a valid gzip stream");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error("Invalid .maket file: JSON parse failed");
	}

	if (!parsed || typeof parsed !== "object")
		throw new Error("Invalid .maket file: not an object");

	const b = parsed as Partial<MaketBundle>;
	if (b.kind !== MAKET_BUNDLE_KIND)
		throw new Error(
			`Invalid .maket file: kind="${b.kind}" (expected "${MAKET_BUNDLE_KIND}")`,
		);
	if (typeof b.version !== "number" || b.version > MAKET_BUNDLE_VERSION)
		throw new Error(
			`Unsupported .maket bundle version ${b.version} (this server handles up to ${MAKET_BUNDLE_VERSION})`,
		);
	if (!Array.isArray(b.documents))
		throw new Error("Invalid .maket file: missing documents[]");

	return {
		version: b.version,
		kind: b.kind,
		exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : "",
		documents: b.documents as BundleDocument[],
		chartes: Array.isArray(b.chartes) ? (b.chartes as Charte[]) : [],
	};
}

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
