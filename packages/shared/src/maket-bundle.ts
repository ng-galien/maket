/**
 * `.maket` bundle wire contract — the single source of truth for the format
 * constants, container sniffing, asset-entry safety, manifest validation and
 * manifest building. Both the server importer (`maket-format.ts`) and the
 * browser viewer/demo decode-encode paths build on this module so the two
 * sides cannot drift.
 *
 * Environment-specific IO stays per-side: gzip/zip codecs, Buffers, blob
 * URLs. Everything here is pure JSON/bytes logic.
 */

export const MAKET_BUNDLE_KIND = "maket-bundle";
export const MAKET_BUNDLE_EXT = ".maket";

/** Versions any Maket reader can decode. Increment on format changes. */
export const SUPPORTED_BUNDLE_VERSIONS: ReadonlySet<number> = new Set([1, 2]);

/** `50 4b 03 04` — v2 ZIP container. */
export function isZipMagic(bytes: Uint8Array): boolean {
	return (
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}

/** `1f 8b` — v1 gzip JSON. */
export function isGzipMagic(bytes: Uint8Array): boolean {
	return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Entries whose name contains `..`, path separators, or resolves outside
 * `assets/` are dropped. Flat filenames are what asset stores expect, so
 * anything else is suspect and never useful.
 */
export function isSafeAssetEntry(entryPath: string): boolean {
	if (!entryPath.startsWith("assets/")) return false;
	const rel = entryPath.slice("assets/".length);
	if (rel.length === 0) return false;
	if (rel.includes("..")) return false;
	if (rel.includes("/") || rel.includes("\\")) return false;
	return true;
}

/** Manifest fields shared by every bundle version; array items stay raw —
 * each side narrows them to its own document/charte types. */
export interface BundleManifestData {
	version: number;
	exportedAt: string;
	documents: unknown[];
	chartes: unknown[];
	collections: unknown[];
}

export function parseBundleManifest(json: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error("Invalid .maket file: JSON parse failed");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Invalid .maket file: manifest is not an object");
	return parsed as Record<string, unknown>;
}

export function validateBundleManifest(
	m: Record<string, unknown>,
): BundleManifestData {
	if (m.kind !== MAKET_BUNDLE_KIND)
		throw new Error(
			`Invalid .maket file: kind="${String(m.kind)}" (expected "${MAKET_BUNDLE_KIND}")`,
		);
	const version = typeof m.version === "number" ? m.version : Number.NaN;
	if (!SUPPORTED_BUNDLE_VERSIONS.has(version))
		throw new Error(
			`Unsupported .maket bundle version ${m.version} (this reader handles ${[...SUPPORTED_BUNDLE_VERSIONS].join(", ")})`,
		);
	if (!Array.isArray(m.documents))
		throw new Error("Invalid .maket file: missing documents[]");

	return {
		version,
		exportedAt: typeof m.exportedAt === "string" ? m.exportedAt : "",
		documents: m.documents,
		chartes: Array.isArray(m.chartes) ? m.chartes : [],
		collections: Array.isArray(m.collections) ? m.collections : [],
	};
}

// ── Encoding side ────────────────────────────────────────────────────────────

/** Structural view of a document as both sides hold it. */
export interface BundleDocumentLike {
	id?: string;
	name: string;
	category?: string;
	canvas?: unknown;
	meta?: object | undefined;
	pages?: readonly object[] | undefined;
	activePage?: number;
	nextId?: number;
}

/** Strip runtime-only fields so the snapshot round-trips cleanly. This is
 * THE field-picking for the wire format — encoders must not hand-roll it. */
export function snapshotBundleDocument(
	doc: BundleDocumentLike,
): Record<string, unknown> {
	return {
		id: doc.id,
		name: doc.name,
		category: doc.category || "general",
		canvas: doc.canvas,
		meta: doc.meta ? { ...doc.meta } : {},
		pages: (doc.pages ?? []).map((page) => {
			const p = page as Record<string, unknown>;
			return {
				id: p.id,
				name: p.name,
				elements: p.elements,
				html: p.html,
				canvas: p.canvas,
				collection: p.collection,
			};
		}),
		activePage: doc.activePage,
		nextId: doc.nextId,
	};
}

export function buildBundleManifest(
	documents: readonly BundleDocumentLike[],
	chartes: readonly unknown[],
	collections: readonly unknown[],
	opts: { version: number; exportedAt: string },
): Record<string, unknown> {
	return {
		version: opts.version,
		kind: MAKET_BUNDLE_KIND,
		exportedAt: opts.exportedAt,
		documents: documents.map(snapshotBundleDocument),
		chartes,
		collections,
	};
}
