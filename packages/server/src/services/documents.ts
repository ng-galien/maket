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
import { normalizeCanvas } from "../types.js";
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
				locked: d.meta?.locked === true,
				updatedAt: timestamps.get(d.name),
				charteColor: resolveCharteColor(d.meta?.charte),
				emailDraftUrl: d.meta?.emailDraftUrl,
				emailDraftRole: d.meta?.emailDraftRole,
			}));
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
	};
}
