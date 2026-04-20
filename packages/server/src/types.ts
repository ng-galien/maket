// ============================================================
// TYPES — shared interfaces and constants
// ============================================================

import crypto from "node:crypto";

export const FORMATS: Record<string, { w: number; h: number }> = {
	A2: { w: 420, h: 594 },
	A3: { w: 297, h: 420 },
	A4: { w: 210, h: 297 },
	A5: { w: 148, h: 210 },
	A6: { w: 105, h: 148 },
	A7: { w: 74, h: 105 },
	A8: { w: 52, h: 74 },
	// Screen formats (1px ≈ 0.2mm, real ratios) — fixed orientation, ignore landscape/portrait
	DESKTOP: { w: 288, h: 205 },
	TABLET: { w: 167, h: 239 },
	MOBILE: { w: 79, h: 170 },
};

export const SCREEN_FORMATS = new Set(["DESKTOP", "TABLET", "MOBILE"]);

/** Compute canvas width/height from format + orientation (screen formats ignore orientation) */
const DEFAULT_DIMS = { w: 297, h: 420 }; // A3

export function computeCanvasDims(
	format: string,
	orientation: string,
): { w: number; h: number } {
	const f = FORMATS[format] ?? DEFAULT_DIMS;
	const isLandscape =
		orientation === "landscape" && !SCREEN_FORMATS.has(format);
	return { w: isLandscape ? f.h : f.w, h: isLandscape ? f.w : f.h };
}

export interface Canvas {
	format: string;
	orientation: string;
	w: number;
	h: number;
	bg: string;
	textMargin?: number;
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
	// Runtime state (not persisted)
	_pending?: PendingMessage[];
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
