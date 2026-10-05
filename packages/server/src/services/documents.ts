/**
 * documents — in-memory document registry backed by a Store.
 *
 * Hydrated at startup via `loadAll()`. Subsequent lookups hit the cached Map;
 * `resolveOrLoad()` transparently falls back to the store for lazy access.
 * Mutations go through `persist()` — handlers never call the store directly.
 *
 * View helpers (`lightView`, `charteCss`) live here because they're the only
 * domain consumers of the document → store projection for UI + email/PDF
 * rendering. Plugins resolve `documents` from the container and call these
 * rather than each inlining their own copy.
 */

import { charteFontImport, charteToCSS } from "../lib/charte-css.js";
import type { Charte, DocSummary, Document } from "../types.js";
import { normalizeCanvas, normalizeDocumentDataModel } from "../types.js";
import { validateStateTemplateUpdate } from "./document-states.js";
import type { Store } from "./store.js";

export interface Documents {
	/** Populate the in-memory registry from the store (idempotent). */
	loadAll(): void;
	/** Lookup by name. Returns null if unknown. No fallback to store. */
	resolve(name: string): Document | null;
	/** Lookup, falling back to the store on a miss and caching the hit. */
	resolveOrLoad(name: string): Document | null;
	/** Lookup by stable id, loading and caching the document on a miss. */
	resolveById(id: string): Document | null;
	/** Persist the cached instance to the store. No-op if the doc is not cached. */
	persist(name: string): void;
	/** Delete from store + cache. Structured Workspace ownership is protected. */
	delete(name: string, opts?: { allowStructuredWorkspace?: boolean }): boolean;
	/** Rename while preserving the stable document identity and related state. */
	rename(name: string, newName: string): void;
	/** Atomically move every cached document in one category subtree. */
	moveCategory(
		source: string,
		destination: string,
	): { moved: Document[]; lockedDocName?: string; ownedDocName?: string };
	/** Summaries of every cached document. */
	list(options?: { includeWorkspaceDocuments?: boolean }): DocSummary[];
	/** Raw access to the backing map. */
	all(): Map<string, Document>;
	/**
	 * Strip base64 hrefs for lighter WS payloads. `focusPage` overrides which
	 * page keeps its full element data (others get `elements: []`).
	 */
	lightView(doc: Document | null, focusPage?: number): Document | null;
	/** Resolve a doc's charte CSS (empty string if none, or on store failure). */
	charteCss(doc: Document | null): string;
	/** Resolve a doc's persistent charte (null if none, missing, or unreadable). */
	charte(doc: Document | null): Charte | null;
}

export interface DocumentsDeps {
	store: Store;
}

function lightweightElements(elements: unknown[]): unknown[] {
	return elements.map((el) => {
		const e = el as { type?: string; path?: string; children?: unknown[] };
		if (e.type === "image" && e.path)
			return { ...e, href: `/assets/${e.path}` };
		if (e.type === "frame" && e.children)
			return { ...e, children: lightweightElements(e.children) };
		return el;
	});
}

function collectionBindings(
	pages: Document["pages"],
): Array<{ name: string; pageCount: number }> {
	const pageCounts = new Map<string, number>();
	for (const page of pages) {
		const name = page.collection?.name;
		if (name) pageCounts.set(name, (pageCounts.get(name) ?? 0) + 1);
	}
	return [...pageCounts]
		.map(([name, pageCount]) => ({ name, pageCount }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function moveDocumentCategory(
	cache: Map<string, Document>,
	store: Store,
	source: string,
	destination: string,
): { moved: Document[]; lockedDocName?: string; ownedDocName?: string } {
	const affected = [...cache.values()].filter(
		(doc) => doc.category === source || doc.category.startsWith(`${source}/`),
	);
	const locked = affected.find((doc) => doc.meta?.locked === true);
	if (locked) return { moved: [], lockedDocName: locked.name };
	const owned = affected.find((doc) => doc.meta.structuredWorkspace);
	if (owned) return { moved: [], ownedDocName: owned.name };
	const previousCategories = affected.map((doc) => doc.category);
	for (const doc of affected) {
		const suffix = doc.category.slice(source.length);
		doc.category = `${destination}${suffix}`;
	}
	try {
		store.saveDocs(affected);
	} catch (error) {
		for (const [index, doc] of affected.entries()) {
			doc.category = previousCategories[index] ?? doc.category;
		}
		throw error;
	}
	return { moved: affected };
}

function deleteDocument(
	cache: Map<string, Document>,
	store: Store,
	name: string,
	allowStructuredWorkspace = false,
): boolean {
	const document = cache.get(name) ?? store.loadOne(name);
	if (
		document &&
		!allowStructuredWorkspace &&
		isStructuredWorkspaceOwned(document)
	) {
		return false;
	}
	store.deleteDoc(name);
	cache.delete(name);
	return true;
}

function listDocumentSummaries(
	cache: Map<string, Document>,
	store: Store,
	includeWorkspaceDocuments = false,
): DocSummary[] {
	const timestamps = store.listTimestamps();
	const charteCache = new Map<string, string | undefined>();
	const resolveCharteColor = (name: string | undefined) => {
		if (!name) return undefined;
		if (charteCache.has(name)) return charteCache.get(name);
		try {
			const charte = store.loadCharte(name);
			const colors = charte?.tokens?.color;
			const color =
				colors?.primary ??
				(colors ? Object.values(colors)[0] : undefined) ??
				undefined;
			charteCache.set(name, color);
			return color;
		} catch {
			charteCache.set(name, undefined);
			return undefined;
		}
	};
	return [...cache.values()]
		.filter(
			(document) =>
				includeWorkspaceDocuments || !isStructuredWorkspaceOwned(document),
		)
		.map((document) => ({
			id: document.id,
			name: document.name,
			category: document.category || "general",
			dataModel: document.dataModel,
			format: document.canvas?.format,
			orientation: document.canvas?.orientation || "portrait",
			rating: document.meta?.rating || 0,
			count: document.pages.reduce(
				(total, page) =>
					total + (page.html?.match(/data-id="[^"]+"/g)?.length ?? 0),
				0,
			),
			charte: document.meta?.charte,
			collectionBindings: collectionBindings(document.pages),
			locked: document.meta?.locked === true,
			updatedAt: timestamps.get(document.name),
			charteColor: resolveCharteColor(document.meta?.charte),
			emailDraftUrl: document.meta?.emailDraftUrl,
			emailDraftRole: document.meta?.emailDraftRole,
		}));
}

export function createDocuments({ store }: DocumentsDeps): Documents {
	const cache = new Map<string, Document>();

	return {
		loadAll() {
			for (const d of store.loadAll()) {
				normalizeCanvas(d.canvas);
				cache.set(d.name, d);
			}
		},
		resolve(name) {
			return cache.get(name) ?? null;
		},
		resolveOrLoad(name) {
			const cached = cache.get(name);
			if (cached) return cached;
			const loaded = store.loadOne(name);
			if (loaded) {
				normalizeCanvas(loaded.canvas);
				cache.set(loaded.name, loaded);
			}
			return loaded ?? null;
		},
		resolveById(id) {
			const cached = [...cache.values()].find((doc) => doc.id === id);
			if (cached) return cached;
			const loaded = store.loadById(id);
			if (loaded) {
				normalizeCanvas(loaded.canvas);
				cache.set(loaded.name, loaded);
			}
			return loaded ?? null;
		},
		persist(name) {
			const d = cache.get(name);
			if (!d) return;
			normalizeDocumentDataModel(d);
			try {
				for (const page of d.pages) {
					validateStateTemplateUpdate(d, store, page);
				}
				store.saveDoc(d);
			} catch (error) {
				restoreCachedDocument(cache, store, name);
				throw error;
			}
		},
		delete(name, opts) {
			return deleteDocument(cache, store, name, opts?.allowStructuredWorkspace);
		},
		rename(name, newName) {
			const d = cache.get(name);
			if (!d) return;
			store.renameDoc(name, newName);
			cache.delete(name);
			d.name = newName;
			cache.set(newName, d);
		},
		moveCategory(source, destination) {
			return moveDocumentCategory(cache, store, source, destination);
		},
		list(options) {
			return listDocumentSummaries(
				cache,
				store,
				options?.includeWorkspaceDocuments,
			);
		},
		all() {
			return cache;
		},
		lightView(doc: Document | null, focusPage?: number): Document | null {
			if (!doc) return doc;
			const focus = focusPage ?? 0;
			return {
				...doc,
				pages: doc.pages.map((p, i) => ({
					...p,
					elements: i === focus ? lightweightElements(p.elements) : [],
				})),
				activePage: focus,
			};
		},
		charteCss(doc) {
			if (!doc?.meta?.charte) return "";
			try {
				const charte = store.loadCharte(doc.meta.charte);
				if (!charte) return "";
				const fontImport = charteFontImport(charte);
				const css = charteToCSS(charte);
				return fontImport ? `${fontImport}\n${css}` : css;
			} catch {
				return "";
			}
		},
		charte(doc) {
			if (!doc?.meta?.charte) return null;
			try {
				return store.loadCharte(doc.meta.charte);
			} catch {
				return null;
			}
		},
	};
}

function isStructuredWorkspaceOwned(document: Document): boolean {
	return Boolean(document.meta.structuredWorkspace);
}

function restoreCachedDocument(
	cache: Map<string, Document>,
	store: Store,
	name: string,
): void {
	const stored = store.loadOne(name);
	if (!stored) {
		cache.delete(name);
		return;
	}
	normalizeCanvas(stored.canvas);
	cache.set(name, stored);
}
