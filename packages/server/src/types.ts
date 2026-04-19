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
	// Screen formats (1px ≈ 0.2mm, real ratios) — fixed orientation, ignore paysage/portrait
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
	const isLandscape = orientation === "paysage" && !SCREEN_FORMATS.has(format);
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
	elements: any[];
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
	elements: any[];
	pages: Page[];
	activePage: number;
	nextId: number;
	// Runtime state (not persisted)
	_pending?: PendingMessage[];
	_layout?: LayoutReport;
	_displayed?: boolean;
	/** Safe accessor for the current active page */
	readonly currentPage: Page;
	/** Safe accessor for a page by index — throws if out of bounds */
	pageAt(idx: number): Page;
}

/** Document implementation with elements getter/setter pointing to active page */
export class DocumentModel implements Document {
	id: string;
	name: string;
	category: string;
	canvas: Canvas;
	meta: DocMeta;
	pages: Page[];
	activePage: number;
	nextId: number;
	_pending?: PendingMessage[];
	_layout?: LayoutReport;
	_displayed?: boolean;

	constructor(init: {
		id?: string;
		name: string;
		category?: string;
		canvas: Canvas;
		meta?: DocMeta;
		pages?: Page[];
		elements?: any[];
		activePage?: number;
		nextId?: number;
	}) {
		this.id = init.id || crypto.randomUUID();
		this.name = init.name;
		this.category = init.category || "general";
		this.canvas = init.canvas;
		this.meta = init.meta || {};
		this.pages = init.pages || [
			{ name: "Page 1", elements: init.elements || [] },
		];
		this.activePage = init.activePage || 0;
		this.nextId = init.nextId || 1;
	}

	get currentPage(): Page {
		return this.pageAt(this.activePage);
	}

	pageAt(idx: number): Page {
		const p = this.pages[Math.min(idx, this.pages.length - 1)] ?? this.pages[0];
		if (!p) throw new Error(`No pages in document "${this.name}"`);
		return p;
	}

	get elements(): any[] {
		return this.currentPage.elements;
	}

	set elements(val: any[]) {
		this.currentPage.elements = val;
	}
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
