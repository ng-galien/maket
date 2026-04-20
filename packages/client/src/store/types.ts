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
	locked?: boolean;
	orientation?: string;
	/** Name of the associated charte, when the doc has one. Used as tooltip
	 * on the colour dot. */
	charte?: string;
	/** ISO-ish timestamp ("YYYY-MM-DD HH:mm:ss") from the server, rendered
	 * relatively ("2h ago") in the UI. */
	updatedAt?: string;
	/** Primary colour of the associated charte — renders as a tiny dot in
	 * the doc row so you can scan the catalog by brand at a glance. */
	charteColor?: string;
}
