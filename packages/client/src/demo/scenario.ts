/**
 * Demo scenario: an honest, pre-recorded replay of a real Maket session.
 * Each step carries a full workspace snapshot (documents/chartes/collections)
 * — replaying a step just re-hydrates the viewer store, no diffing. Every
 * artifact is a genuine Maket document frozen at that moment, and the final
 * state is downloadable as a real `.maket` bundle.
 *
 * Visual identity mirrors the Maket site: Manrope + DM Mono, paper #f4f0e8,
 * ink #101c19, teal accent #00a99d.
 */

import type { Collection } from "@maket/shared";
import type { Document } from "../store/types";
import type { ViewerCharte } from "../viewer/bundle";

export interface DemoWorkspace {
	documents: Document[];
	chartes: ViewerCharte[];
	collections: Collection[];
}

export interface DemoStep {
	id: string;
	actor: "user" | "agent" | "info";
	caption: string;
	/** Full snapshot to hydrate; omit to keep the previous step's workspace. */
	workspace?: DemoWorkspace;
	/** Element ids to flag with a user-note badge on the focused doc. */
	notes?: { elementId: string; text: string }[];
	/** Collection preview mode to apply after hydration. */
	collectionMode?: "template" | "rendered" | "all";
}

/** Workspace of the last step that carries one — what the download contains. */
export function finalWorkspace(scenario: DemoScenario): DemoWorkspace {
	for (let i = scenario.steps.length - 1; i >= 0; i--) {
		const workspace = scenario.steps[i]?.workspace;
		if (workspace) return workspace;
	}
	return { documents: [], chartes: [], collections: [] };
}

export interface DemoScenario {
	id: string;
	title: string;
	downloadName: string;
	steps: DemoStep[];
}

/** Site fonts, shared by every demo charte. */
export const SITE_FONTS_IMPORT =
	"@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;600;700;800&display=swap');";

export const FARM_LOGO_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#00a99d"/><path d="M32 14 C40 24 44 32 32 50 C20 32 24 24 32 14 Z" fill="#f4f0e8"/></svg>',
)}`;

const greenmarketCharte: ViewerCharte = {
	name: "greenmarket",
	css: [
		SITE_FONTS_IMPORT,
		":root {",
		"  --charte-color-bg: #f4f0e8;",
		"  --charte-color-ink: #101c19;",
		"  --charte-color-accent: #00a99d;",
		"  --charte-color-accent-light: #a3f2ea;",
		"  --charte-color-muted: #66716d;",
		"  --charte-color-line: rgba(16, 28, 25, 0.16);",
		"  --charte-font-heading: 'Manrope', sans-serif;",
		"  --charte-font-mono: 'DM Mono', monospace;",
		"}",
	].join("\n"),
};

const productsCollection: Collection = {
	name: "products",
	description: "Farm shop price labels",
	schema: {
		type: "object",
		properties: {
			name: { type: "string" },
			price: { type: "string" },
			unit: { type: "string" },
			origin: { type: "string" },
		},
		required: ["name", "price", "unit", "origin"],
	},
	members: [
		{
			id: "m1",
			position: 1,
			data: {
				name: "Heritage Tomatoes",
				price: "4,20 €",
				unit: "kg",
				origin: "Loire Valley",
			},
		},
		{
			id: "m2",
			position: 2,
			data: {
				name: "Raw Honey",
				price: "7,80 €",
				unit: "500 g",
				origin: "Cévennes",
			},
		},
		{
			id: "m3",
			position: 3,
			data: {
				name: "Goat Cheese",
				price: "3,50 €",
				unit: "piece",
				origin: "Poitou",
			},
		},
		{
			id: "m4",
			position: 4,
			data: {
				name: "Sourdough Loaf",
				price: "5,00 €",
				unit: "800 g",
				origin: "Baked here",
			},
		},
		{
			id: "m5",
			position: 5,
			data: {
				name: "Cider Brut",
				price: "6,40 €",
				unit: "75 cl",
				origin: "Normandy",
			},
		},
		{
			id: "m6",
			position: 6,
			data: {
				name: "Walnut Oil",
				price: "11,90 €",
				unit: "25 cl",
				origin: "Périgord",
			},
		},
	],
};

function labelsDoc(opts: {
	charte?: boolean;
	html: string;
	collection?: boolean;
}): Document {
	return {
		id: "price-labels",
		name: "price-labels",
		category: "label",
		canvas: { w: 90, h: 54, background: "#f4f0e8", format: "custom" },
		activePage: 0,
		meta: opts.charte ? { charte: "greenmarket" } : {},
		pages: [
			{
				id: "l1",
				name: "Label",
				elements: [],
				...(opts.collection ? { collection: { name: "products" } } : {}),
				html: opts.html,
			},
		],
	};
}

const draftHtml = `<div style="width:100%;height:100%;font-family:sans-serif;display:flex;flex-direction:column;justify-content:center;padding:5mm;border:1px solid #999">
  <div data-id="name" style="font-size:16px;font-weight:700">{{ name }}</div>
  <div data-id="origin" style="font-size:11px">{{ origin }}</div>
  <div data-id="price" style="font-size:14px;margin-top:2mm">{{ price }} / {{ unit }}</div>
</div>`;

const chartedHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:var(--charte-font-heading);color:var(--charte-color-ink);display:flex;flex-direction:column;padding:4mm 5mm;border:1.5px solid var(--charte-color-ink);border-radius:3px;position:relative;overflow:hidden">
  <div style="position:absolute;top:0;left:0;right:0;height:2mm;background:var(--charte-color-accent)"></div>
  <div style="display:flex;align-items:center;gap:2.5mm;margin-top:2mm">
    <span data-id="brand" style="font-family:var(--charte-font-mono);font-size:9px;letter-spacing:0.18em;color:var(--charte-color-muted)">GREENMARKET · FARM SHOP</span>
    <span data-id="origin" style="margin-left:auto;font-size:9px;font-weight:700;color:var(--charte-color-accent);border:1px solid var(--charte-color-accent);border-radius:999px;padding:0.5mm 2mm">{{ origin }}</span>
  </div>
  <div data-id="name" style="font-size:20px;font-weight:800;letter-spacing:-0.02em;margin-top:2.5mm;line-height:1.05">{{ name }}</div>
  <div style="margin-top:auto;display:flex;align-items:baseline;gap:2mm;border-top:1px dashed var(--charte-color-line);padding-top:2mm">
    <span data-id="price" style="font-size:15px;font-weight:700">{{ price }}</span>
    <span data-id="unit" style="font-family:var(--charte-font-mono);font-size:10px;color:var(--charte-color-muted)">/ {{ unit }}</span>
  </div>
</div>`;

const revisedHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:var(--charte-font-heading);color:var(--charte-color-ink);display:flex;flex-direction:column;padding:4mm 5mm;border:1.5px solid var(--charte-color-ink);border-radius:3px;position:relative;overflow:hidden">
  <div style="position:absolute;top:0;left:0;right:0;height:2mm;background:var(--charte-color-accent)"></div>
  <div style="display:flex;align-items:center;gap:2.5mm;margin-top:2mm">
    <img data-id="logo" data-name="logo" src="${FARM_LOGO_DATA_URI}" alt="" style="width:8mm;height:8mm;flex-shrink:0"/>
    <span data-id="brand" style="font-family:var(--charte-font-mono);font-size:9px;letter-spacing:0.18em;color:var(--charte-color-muted)">GREENMARKET · FARM SHOP</span>
    <span data-id="origin" style="margin-left:auto;font-size:9px;font-weight:700;color:var(--charte-color-accent);border:1px solid var(--charte-color-accent);border-radius:999px;padding:0.5mm 2mm;white-space:nowrap">{{ origin }}</span>
  </div>
  <div data-id="name" style="font-size:21px;font-weight:800;letter-spacing:-0.02em;margin-top:2.5mm;line-height:1.05">{{ name }}</div>
  <div style="margin-top:auto;display:flex;align-items:baseline;gap:2mm;border-top:1px dashed var(--charte-color-line);padding-top:2mm">
    <span data-id="price" style="font-family:var(--charte-font-mono);font-size:25px;font-weight:500;color:var(--charte-color-accent)">{{ price }}</span>
    <span data-id="unit" style="font-family:var(--charte-font-mono);font-size:11px;color:var(--charte-color-muted)">/ {{ unit }}</span>
    <span style="margin-left:auto;font-family:var(--charte-font-mono);font-size:8px;color:var(--charte-color-muted)">maket.dev</span>
  </div>
</div>`;

export const productCatalogScenario: DemoScenario = {
	id: "product-catalog",
	title: "Price labels from a data collection",
	downloadName: "product-catalog.maket",
	steps: [
		{
			id: "request",
			actor: "user",
			caption:
				"“Create price labels for my farm shop — here's my product list.”",
			workspace: { documents: [], chartes: [], collections: [] },
		},
		{
			id: "draft",
			actor: "agent",
			caption: "The agent drafts a first label template with placeholders.",
			workspace: {
				documents: [labelsDoc({ html: draftHtml })],
				chartes: [],
				collections: [],
			},
		},
		{
			id: "charte",
			actor: "agent",
			caption:
				"A charte is applied: paper, ink and teal become design tokens with real web fonts.",
			workspace: {
				documents: [labelsDoc({ charte: true, html: chartedHtml })],
				chartes: [greenmarketCharte],
				collections: [],
			},
		},
		{
			id: "annotate",
			actor: "user",
			caption: "You annotate the label: “The price should stand out more.”",
			notes: [{ elementId: "price", text: "The price should stand out more" }],
		},
		{
			id: "revise",
			actor: "agent",
			caption:
				"The agent revises: monospace accent price, logo, brand line — a label worth printing.",
			workspace: {
				documents: [labelsDoc({ charte: true, html: revisedHtml })],
				chartes: [greenmarketCharte],
				collections: [],
			},
		},
		{
			id: "collection",
			actor: "agent",
			caption:
				"Your product list becomes a collection — one template, six real labels.",
			workspace: {
				documents: [
					labelsDoc({ charte: true, html: revisedHtml, collection: true }),
				],
				chartes: [greenmarketCharte],
				collections: [productsCollection],
			},
			collectionMode: "all",
		},
		{
			id: "own-it",
			actor: "info",
			caption:
				"This is a real .maket file — download it and keep working with any agent.",
			collectionMode: "all",
		},
	],
};
