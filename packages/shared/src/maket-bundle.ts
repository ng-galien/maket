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

import {
	type DocumentStateData,
	type DocumentStateSchema,
	renderDocumentStateText,
	validateDocumentState,
} from "./document-state.js";

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
	documentStates: BundleDocumentStateSnapshot[];
}

/** Current portable snapshot for one state-backed document. Revision history
 * stays local; an import initializes this snapshot as revision 1. */
export interface BundleDocumentStateSnapshot {
	documentId: string;
	schema: DocumentStateSchema;
	data: DocumentStateData;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasPositiveDimension(
	canvas: Record<string, unknown>,
	key: "w" | "h",
): boolean {
	const value = canvas[key];
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateBundleDocument(value: unknown, index: number): void {
	if (!isPlainRecord(value)) {
		throw new Error(
			`Invalid .maket file: documents[${index}] is not an object`,
		);
	}
	if (typeof value.name !== "string" || value.name.trim().length === 0) {
		throw new Error(`Invalid .maket file: documents[${index}].name is missing`);
	}
	if (
		!isPlainRecord(value.canvas) ||
		!hasPositiveDimension(value.canvas, "w") ||
		!hasPositiveDimension(value.canvas, "h")
	) {
		throw new Error(
			`Invalid .maket file: documents[${index}].canvas needs positive w/h`,
		);
	}
	if (!Array.isArray(value.pages)) {
		throw new Error(
			`Invalid .maket file: documents[${index}].pages is missing`,
		);
	}
	for (const [pageIndex, page] of value.pages.entries()) {
		if (!isPlainRecord(page)) {
			throw new Error(
				`Invalid .maket file: documents[${index}].pages[${pageIndex}] is not an object`,
			);
		}
		if (page.html !== undefined && typeof page.html !== "string") {
			throw new Error(
				`Invalid .maket file: documents[${index}].pages[${pageIndex}].html is not text`,
			);
		}
		if (page.elements !== undefined && !Array.isArray(page.elements)) {
			throw new Error(
				`Invalid .maket file: documents[${index}].pages[${pageIndex}].elements is not an array`,
			);
		}
	}
}

function validateBundleCharte(value: unknown, index: number): void {
	if (
		!isPlainRecord(value) ||
		typeof value.name !== "string" ||
		value.name.trim().length === 0 ||
		(value.css !== undefined && typeof value.css !== "string")
	) {
		throw new Error(`Invalid .maket file: chartes[${index}] is malformed`);
	}
}

function validateBundleCollection(value: unknown, index: number): void {
	if (
		!isPlainRecord(value) ||
		typeof value.name !== "string" ||
		value.name.trim().length === 0 ||
		!isPlainRecord(value.schema) ||
		!Array.isArray(value.members)
	) {
		throw new Error(`Invalid .maket file: collections[${index}] is malformed`);
	}
	for (const [memberIndex, member] of value.members.entries()) {
		if (
			!isPlainRecord(member) ||
			typeof member.id !== "string" ||
			typeof member.position !== "number" ||
			!Number.isFinite(member.position) ||
			!isPlainRecord(member.data)
		) {
			throw new Error(
				`Invalid .maket file: collections[${index}].members[${memberIndex}] is malformed`,
			);
		}
	}
}

interface BundleDocumentStateValidationContext {
	docsById: Map<string, { document: Record<string, unknown>; index: number }>;
	seen: Set<string>;
}

function indexBundleDocuments(
	documents: unknown[],
): BundleDocumentStateValidationContext["docsById"] {
	const docsById: BundleDocumentStateValidationContext["docsById"] = new Map();
	for (const [index, document] of documents.entries()) {
		if (!isPlainRecord(document) || typeof document.id !== "string") continue;
		if (docsById.has(document.id)) {
			throw new Error(
				`Invalid .maket file: duplicate document id "${document.id}"`,
			);
		}
		docsById.set(document.id, { document, index });
	}
	return docsById;
}

function validateBundleDocumentState(
	value: unknown,
	index: number,
	context: BundleDocumentStateValidationContext,
): BundleDocumentStateSnapshot {
	if (
		!isPlainRecord(value) ||
		typeof value.documentId !== "string" ||
		value.documentId.length === 0 ||
		!isPlainRecord(value.schema) ||
		!isPlainRecord(value.data)
	) {
		throw new Error(
			`Invalid .maket file: documentStates[${index}] is malformed`,
		);
	}
	if (context.seen.has(value.documentId)) {
		throw new Error(
			`Invalid .maket file: duplicate state for document "${value.documentId}"`,
		);
	}
	context.seen.add(value.documentId);
	const indexedDocument = context.docsById.get(value.documentId);
	if (indexedDocument?.document.dataModel !== "state") {
		throw new Error(
			`Invalid .maket file: documentStates[${index}] does not reference a state-backed document`,
		);
	}
	const schema = value.schema as DocumentStateSchema;
	const data = value.data as DocumentStateData;
	const issues = validateDocumentState(schema, data);
	if (issues.length > 0) {
		throw new Error(
			`Invalid .maket file: documentStates[${index}] ${issues.join("; ")}`,
		);
	}
	for (const [pageIndex, page] of (
		indexedDocument.document.pages as unknown[]
	).entries()) {
		if (!isPlainRecord(page) || typeof page.html !== "string") continue;
		try {
			renderDocumentStateText(page.html, data, { schema });
		} catch (error) {
			throw new Error(
				`Invalid .maket file: state template documents[${indexedDocument.index}].pages[${pageIndex}] ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return { documentId: value.documentId, schema, data };
}

function validateBundleDocumentStates(
	values: unknown[],
	documents: unknown[],
): BundleDocumentStateSnapshot[] {
	const context: BundleDocumentStateValidationContext = {
		docsById: indexBundleDocuments(documents),
		seen: new Set(),
	};
	const snapshots: BundleDocumentStateSnapshot[] = [];
	for (const [index, value] of values.entries()) {
		snapshots.push(validateBundleDocumentState(value, index, context));
	}
	for (const doc of documents) {
		if (
			isPlainRecord(doc) &&
			doc.dataModel === "state" &&
			(typeof doc.id !== "string" || !context.seen.has(doc.id))
		) {
			throw new Error(
				`Invalid .maket file: state-backed document "${String(doc.name)}" has no current state snapshot`,
			);
		}
	}
	return snapshots;
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
	const chartes = Array.isArray(m.chartes) ? m.chartes : [];
	const collections = Array.isArray(m.collections) ? m.collections : [];
	const documentStates = Array.isArray(m.documentStates)
		? m.documentStates
		: [];
	m.documents.forEach(validateBundleDocument);
	chartes.forEach(validateBundleCharte);
	collections.forEach(validateBundleCollection);
	const validatedStates = validateBundleDocumentStates(
		documentStates,
		m.documents,
	);

	return {
		version,
		exportedAt: typeof m.exportedAt === "string" ? m.exportedAt : "",
		documents: m.documents,
		chartes,
		collections,
		documentStates: validatedStates,
	};
}

// ── Encoding side ────────────────────────────────────────────────────────────

/** Structural view of a document as both sides hold it. */
export interface BundleDocumentLike {
	id?: string;
	name: string;
	category?: string;
	dataModel?: "static" | "collection" | "state";
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
		dataModel: doc.dataModel,
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
	opts: {
		version: number;
		exportedAt: string;
		documentStates?: readonly BundleDocumentStateSnapshot[];
	},
): Record<string, unknown> {
	return {
		version: opts.version,
		kind: MAKET_BUNDLE_KIND,
		exportedAt: opts.exportedAt,
		documents: documents.map(snapshotBundleDocument),
		chartes,
		collections,
		documentStates: opts.documentStates ?? [],
	};
}
