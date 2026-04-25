// ============================================================
// TYPES — server-side domain interfaces. Static format tables and the
// canvas-dims helper live in @maket/shared so the client doesn't
// duplicate them.
// ============================================================

import crypto from "node:crypto";

export { computeCanvasDims, FORMATS, SCREEN_FORMATS } from "@maket/shared";

export interface Margins {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface Canvas {
	format: string;
	orientation: string;
	w: number;
	h: number;
	bg: string;
	/**
	 * Safe-zone insets in mm. When set, the layout verdict reports `tight`
	 * for blocks that cross into any margin band, and the client draws
	 * dashed guides at the inset edges. When absent, only overflow (canvas
	 * edge crossings) is reported.
	 */
	margins?: Margins;
}

/**
 * Canvas migration: pre-margins docs persisted a uniform `textMargin: number`.
 * Mutates `canvas` in place to convert legacy `textMargin: N` to
 * `margins: {top:N, right:N, bottom:N, left:N}` and drop the legacy field.
 * No-op on canvases that already use the new shape or have no margins set.
 */
export function normalizeCanvas(canvas: Canvas): Canvas {
	const legacy = (canvas as { textMargin?: number }).textMargin;
	if (legacy != null && !canvas.margins) {
		canvas.margins = {
			top: legacy,
			right: legacy,
			bottom: legacy,
			left: legacy,
		};
	}
	delete (canvas as { textMargin?: number }).textMargin;
	return canvas;
}

export interface DocMeta {
	designNotes?: string;
	teamNotes?: string;
	rating?: number;
	charte?: string;
	session?: string;
	/** When true, MCP mutation tools refuse to edit the document. */
	locked?: boolean;
	// Email fields — present when category === "email"
	emailTo?: string;
	emailCc?: string;
	emailBcc?: string;
	emailSubject?: string;
	emailAttachments?: string[]; // doc IDs to attach as PDFs
	emailDraftId?: string; // Gmail draft ID after gmail_draft
	emailDraftUrl?: string; // Deep link to review & send the draft in Gmail
	emailDraftRole?: "body" | "attachment"; // How this doc was included in the last draft
}

export interface Page {
	name?: string;
	elements: unknown[];
	html?: string;
	canvas?: Partial<Canvas>;
}

export interface LayoutReport {
	overflow: boolean;
	containerHeight: number;
	contentHeight: number;
	overflowBy: number;
	overflowing: string[];
}

import type { PendingMessage } from "@maket/shared";

export type { PendingMessage };

export interface Document {
	id: string;
	name: string;
	category: string;
	canvas: Canvas;
	meta: DocMeta;
	pages: Page[];
	activePage: number;
	nextId: number;
	// Runtime state (not persisted). Pending messages live in the `pending`
	// service — see packages/server/src/services/pending.ts.
	_layout?: LayoutReport;
	_displayed?: boolean;
}

export interface DocumentInit {
	id?: string;
	name: string;
	category?: string;
	canvas: Canvas;
	meta?: DocMeta;
	pages?: Page[];
	elements?: unknown[];
	activePage?: number;
	nextId?: number;
}

/** Factory — produces a plain Document with sane defaults. */
export function createDocument(init: DocumentInit): Document {
	return {
		id: init.id || crypto.randomUUID(),
		name: init.name,
		category: init.category || "general",
		canvas: init.canvas,
		meta: init.meta || {},
		pages: init.pages || [{ name: "Page 1", elements: init.elements || [] }],
		activePage: init.activePage || 0,
		nextId: init.nextId || 1,
	};
}

export interface DocSummary {
	id: string;
	name: string;
	category: string;
	format: string;
	orientation: string;
	rating: number;
	count: number;
	charte?: string;
	locked?: boolean;
	/** ISO-ish timestamp ("2026-04-20 14:59:27") of the last save — used by the
	 * client to render a relative "N min ago" label. */
	updatedAt?: string;
	/** Primary colour of the associated charte (first colour token if
	 * `primary` is missing), returned so the UI can render a tiny dot without
	 * a second round-trip. Omitted when the doc has no charte. */
	charteColor?: string;
	/** Gmail deep link to the draft this doc is part of — surfaced in the
	 * sidebar + workspace label when present. */
	emailDraftUrl?: string;
	emailDraftRole?: "body" | "attachment";
}

// ---- Charte graphique ----

// ---- Charte graphique (v2 — design tokens + voice + rules) ----

export interface CharteTokens {
	color?: Record<string, string>;
	font?: Record<string, string>;
	spacing?: Record<string, string>;
	radius?: Record<string, string>;
	shadow?: Record<string, string>;
	[key: string]: Record<string, string> | undefined;
}

export interface CharteVoice {
	personality?: string[];
	do?: string[];
	dont?: string[];
	formality?: string;
	vocabulary?: string[];
	examples?: { good: string; bad: string; context?: string }[];
}

export interface CharteRules {
	titles?: string;
	photos?: string;
	layout?: string;
	[key: string]: string | undefined;
}

export interface Charte {
	name: string;
	description?: string;
	tokens: CharteTokens;
	voice?: CharteVoice;
	rules?: CharteRules;
	css?: string;
}
