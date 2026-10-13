import type { DocumentStateSlotRenderer } from "@maket/shared";
import { renderStateMermaid } from "../lib/state-mermaid.js";
import type { Charte, Document } from "../types.js";
import type { Documents } from "./documents.js";

const DEFAULT_CACHE_SIZE = 256;

export interface StateRenderSlots {
	/** The renderer of the render slots of one document, drawing with the
	 * charte the document carries at call time. */
	forDocument(doc: Document): DocumentStateSlotRenderer;
}

export interface StateRenderSlotsDeps {
	documents: Pick<Documents, "charte">;
}

export interface StateRenderSlotsOptions {
	/** Rendered slots kept, keyed by source and charte. */
	cacheSize?: number;
}

/**
 * Draws render slots at render time. A slot whose source cannot be drawn
 * shows the error as text instead of failing the whole render.
 */
export function createStateRenderSlots(
	deps: StateRenderSlotsDeps,
	opts: StateRenderSlotsOptions = {},
): StateRenderSlots {
	const cacheSize = opts.cacheSize ?? DEFAULT_CACHE_SIZE;
	const cache = new Map<string, string>();

	function drawn(source: string, charte: Charte | null): string {
		const key = JSON.stringify([
			charte?.name ?? null,
			charte?.tokens ?? null,
			source,
		]);
		const cached = cache.get(key);
		if (cached !== undefined) {
			cache.delete(key);
			cache.set(key, cached);
			return cached;
		}
		const html = drawOrExplain(source, charte);
		cache.set(key, html);
		while (cache.size > cacheSize) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
		return html;
	}

	return {
		forDocument(doc) {
			const charte = deps.documents.charte(doc);
			return (slot) => drawn(slot.source, charte);
		},
	};
}

function drawOrExplain(source: string, charte: Charte | null): string {
	try {
		return renderStateMermaid(source, charte);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `<p class="maket-render-error">${escapeHtml(`Diagram error: ${message}`)}</p>`;
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
