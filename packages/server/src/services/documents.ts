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
import type { DocSummary, Document } from "../types.js";
import type { Store } from "./store.js";

export interface Documents {
	/** Populate the in-memory registry from the store (idempotent). */
	loadAll(): void;
	/** Lookup by name. Returns null if unknown. No fallback to store. */
	resolve(name: string): Document | null;
	/** Lookup, falling back to the store on a miss and caching the hit. */
	resolveOrLoad(name: string): Document | null;
	/** Persist the cached instance to the store. No-op if the doc is not cached. */
	persist(name: string): void;
	/** Delete from store + cache. */
	delete(name: string): void;
	/** Summaries of every cached document. */
	list(): DocSummary[];
	/** Raw access to the backing map. */
	all(): Map<string, Document>;
	/**
	 * Strip base64 hrefs for lighter WS payloads. `focusPage` overrides which
	 * page keeps its full element data (others get `elements: []`).
	 */
	lightView(doc: Document | null, focusPage?: number): Document | null;
	/** Resolve a doc's charte CSS (empty string if none, or on store failure). */
	charteCss(doc: Document | null): string;
}

export interface DocumentsDeps {
	store: Store;
}

// biome-ignore lint/suspicious/noExplicitAny: canvas element shapes are loose
function lightweightElements(elements: any[]): any[] {
	return elements.map((el) => {
		if (el.type === "image" && el.path)
			return { ...el, href: `/assets/${el.path}` };
		if (el.type === "frame" && el.children)
			return { ...el, children: lightweightElements(el.children) };
		return el;
	});
}

export function createDocuments({ store }: DocumentsDeps): Documents {
	const cache = new Map<string, Document>();

	return {
		loadAll() {
			for (const d of store.loadAll()) cache.set(d.name, d);
		},
		resolve(name) {
			return cache.get(name) ?? null;
		},
		resolveOrLoad(name) {
			const cached = cache.get(name);
			if (cached) return cached;
			const loaded = store.loadOne(name);
			if (loaded) cache.set(loaded.name, loaded);
			return loaded ?? null;
		},
		persist(name) {
			const d = cache.get(name);
			if (!d) return;
			store.saveDoc(d);
		},
		delete(name) {
			store.deleteDoc(name);
			cache.delete(name);
		},
		list() {
			return [...cache.values()].map((d) => ({
				id: d.id,
				name: d.name,
				category: d.category || "general",
				format: d.canvas?.format,
				orientation: d.canvas?.orientation || "portrait",
				rating: d.meta?.rating || 0,
				count: d.pages.reduce(
					(n, p) => n + (p.html?.match(/data-id="[^"]+"/g)?.length ?? 0),
					0,
				),
				charte: d.meta?.charte,
			}));
		},
		all() {
			return cache;
		},
		// biome-ignore lint/suspicious/noExplicitAny: see lightweightElements
		lightView(doc: Document | null, focusPage?: number): any {
			if (!doc) return doc;
			const focus = focusPage ?? 0;
			return {
				...doc,
				elements: lightweightElements(
					(doc as unknown as { elements: unknown[] }).elements || [],
				),
				pages: doc.pages.map((p, i) => ({
					...p,
					elements:
						i === focus ? lightweightElements(p.elements as unknown[]) : [],
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
	};
}
