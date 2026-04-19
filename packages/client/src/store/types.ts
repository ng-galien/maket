export interface Canvas {
	w: number;
	h: number;
	background: string;
	format?: string;
	orientation?: string;
	textMargin?: number;
	bleed?: number;
}

export interface Element {
	id: string;
	type: "text" | "image" | "rect" | "line" | "frame";
	name?: string;
	x: number;
	y: number;
	[key: string]: any;
}

export interface Page {
	name: string;
	elements: Element[];
	html?: string;
}

export interface Document {
	id: string;
	name: string;
	category: string;
	canvas: Canvas;
	elements: Element[];
	pages: Page[];
	activePage: number;
	meta?: Record<string, any>;
	charte?: string;
}

export interface DocSummary {
	id: string;
	name: string;
	category: string;
	format: string;
	pageCount: number;
	elementCount: number;
	rating?: number;
}
