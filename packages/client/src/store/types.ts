export interface Margins {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface Canvas {
	w: number;
	h: number;
	background: string;
	format?: string;
	orientation?: string;
	margins?: Margins;
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
	id: string;
	name: string;
	elements: Element[];
	html?: string;
	collection?: { name: string };
}

export interface Document {
	id: string;
	name: string;
	category: string;
	/** Absent on legacy viewer bundles; the client treats it as static. */
	dataModel?: "static" | "collection" | "state";
	canvas: Canvas;
	pages: Page[];
	activePage: number;
	meta?: Record<string, any>;
	charte?: string;
	collection?: { name: string };
	collectionCount?: number;
}

export interface DocSummary {
	id: string;
	name: string;
	category: string;
	/** Absent on summaries emitted by older Maket servers. */
	dataModel?: "static" | "collection" | "state";
	format: string;
	pageCount: number;
	elementCount: number;
	collectionBindings: Array<{ name: string; pageCount: number }>;
	rating?: number;
	locked?: boolean;
	orientation?: string;
	/** Name of the associated charte, when the doc has one. Used by the
	 * compact charte indicator and its tooltip. */
	charte?: string;
	/** ISO-ish timestamp ("YYYY-MM-DD HH:mm:ss") from the server, rendered
	 * relatively ("2h ago") in the UI. */
	updatedAt?: string;
	/** Primary colour of the associated charte — rendered inside the compact
	 * charte indicator so the catalog can be scanned by brand at a glance. */
	charteColor?: string;
	/** Gmail deep link to the draft this doc is part of. Surfaced as a
	 * discreet "Draft ready / In draft" pill in the sidebar when present. */
	emailDraftUrl?: string;
	emailDraftRole?: "body" | "attachment";
}
