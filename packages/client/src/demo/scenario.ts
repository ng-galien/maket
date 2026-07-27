/**
 * Demo scenario: an honest, pre-recorded replay of a real Maket session.
 * Each step carries a full workspace snapshot (documents/chartes/collections)
 * — replaying a step just re-hydrates the viewer store, no diffing. Every
 * artifact is a genuine Maket document frozen at that moment, and the final
 * state is downloadable as a real `.maket` bundle.
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

export interface DemoScenario {
	id: string;
	title: string;
	downloadName: string;
	steps: DemoStep[];
}

const FARM_LOGO_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#2f6b4f"/><path d="M32 14 C40 24 44 32 32 50 C20 32 24 24 32 14 Z" fill="#eaf3e2"/></svg>',
)}`;

const greenmarketCharte: ViewerCharte = {
	name: "greenmarket",
	css: [
		":root {",
		"  --charte-color-bg: #f6f3ea;",
		"  --charte-color-primary: #2f6b4f;",
		"  --charte-color-accent: #c85a19;",
		"  --charte-color-text: #2b2a26;",
		"  --charte-font-body: Georgia, serif;",
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
	charte?: string;
	html: string;
	collection?: boolean;
}): Document {
	return {
		id: "price-labels",
		name: "price-labels",
		category: "label",
		canvas: { w: 90, h: 54, background: "#f6f3ea", format: "custom" },
		activePage: 0,
		meta: opts.charte ? { charte: opts.charte } : {},
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

const chartedHtml = `<div style="width:100%;height:100%;font-family:var(--charte-font-body);color:var(--charte-color-text);display:flex;flex-direction:column;justify-content:center;gap:1mm;padding:5mm;border:2px solid var(--charte-color-primary);border-radius:4px">
  <div data-id="name" style="font-size:18px;font-weight:700;color:var(--charte-color-primary)">{{ name }}</div>
  <div data-id="origin" style="font-size:11px;font-style:italic">{{ origin }}</div>
  <div data-id="price" style="font-size:14px;margin-top:1mm">{{ price }} / {{ unit }}</div>
</div>`;

const revisedHtml = `<div style="width:100%;height:100%;font-family:var(--charte-font-body);color:var(--charte-color-text);display:flex;align-items:center;gap:5mm;padding:5mm;border:2px solid var(--charte-color-primary);border-radius:4px">
  <img data-id="logo" data-name="logo" src="${FARM_LOGO_DATA_URI}" alt="" style="width:13mm;height:13mm;flex-shrink:0"/>
  <div style="flex:1;min-width:0">
    <div data-id="name" style="font-size:19px;font-weight:700;color:var(--charte-color-primary)">{{ name }}</div>
    <div data-id="origin" style="font-size:12px;font-style:italic;margin-top:1mm">{{ origin }}</div>
  </div>
  <div style="text-align:right;flex-shrink:0">
    <div data-id="price" style="font-size:24px;font-weight:700;color:var(--charte-color-accent)">{{ price }}</div>
    <div data-id="unit" style="font-size:11px;color:var(--charte-color-primary)">per {{ unit }}</div>
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
				"A charte is applied: the greenmarket palette and typography become design tokens.",
			workspace: {
				documents: [labelsDoc({ charte: "greenmarket", html: chartedHtml })],
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
				"The agent revises: bigger accent price, logo added, tighter layout.",
			workspace: {
				documents: [labelsDoc({ charte: "greenmarket", html: revisedHtml })],
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
					labelsDoc({
						charte: "greenmarket",
						html: revisedHtml,
						collection: true,
					}),
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
