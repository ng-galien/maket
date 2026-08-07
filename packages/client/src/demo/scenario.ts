/**
 * Demo scenario: an honest, pre-recorded replay of a real Maket session.
 * Each step carries a full workspace snapshot (documents/chartes/collections)
 * — replaying a step just re-hydrates the viewer store, no diffing. Every
 * artifact is a genuine Maket document frozen at that moment. Portable
 * scenarios expose their final state as a real `.maket` bundle. State-backed
 * bundles carry their current schema and data snapshot, not revision history.
 *
 * Visual identity mirrors the Maket site: Manrope + DM Mono chrome, Fraunces
 * editorial serif in documents, paper #fbfaf6, ink #101c19, teal #00a99d.
 */

import type { Collection, DocumentStateClientView } from "@maket/shared";
import type { Document } from "../store/types";
import type { ViewerCharte } from "../viewer/bundle";
import { PRODUCE_CRATE, PRODUCT_ICONS, svgUri } from "./illustrations";

export interface DemoWorkspace {
	documents: Document[];
	chartes: ViewerCharte[];
	collections: Collection[];
	documentStates?: Record<string, DocumentStateClientView>;
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
	/** Page index to frame after hydration (defaults to fitting the whole
	 * workspace) — lets a step zoom on the page that just arrived. */
	focusPage?: number;
}

export const EMPTY_WORKSPACE: DemoWorkspace = {
	documents: [],
	chartes: [],
	collections: [],
};

/** Workspace in effect at a step (last step at or before it carrying one). */
export function workspaceAt(
	scenario: DemoScenario,
	index: number,
): DemoWorkspace {
	for (let i = index; i >= 0; i--) {
		const workspace = scenario.steps[i]?.workspace;
		if (workspace) return workspace;
	}
	return EMPTY_WORKSPACE;
}

/** Workspace of the last step that carries one — the replay's final state. */
export const finalWorkspace = (scenario: DemoScenario): DemoWorkspace =>
	workspaceAt(scenario, scenario.steps.length - 1);

/** Every scenario closes on the same pitch. */
export function ownItStep(
	collectionMode?: DemoStep["collectionMode"],
): DemoStep {
	return {
		id: "own-it",
		actor: "info",
		caption:
			"This is a real .maket file — download it and keep working with any agent.",
		...(collectionMode ? { collectionMode } : {}),
	};
}

/** Site-identity charte; scenarios only vary name, background and overrides. */
export function siteCharte(
	name: string,
	opts?: { bg?: string; extraTokens?: string[] },
): ViewerCharte {
	return {
		name,
		css: [
			SITE_FONTS_IMPORT,
			":root {",
			`  --charte-color-bg: ${opts?.bg ?? "#fbfaf6"};`,
			...SITE_CHARTE_TOKENS,
			...(opts?.extraTokens ?? []),
			"}",
		].join("\n"),
	};
}

export interface DemoScenario {
	id: string;
	title: string;
	downloadName: string;
	steps: DemoStep[];
}

/** Site fonts, shared by every demo charte. Manrope + DM Mono are the site
 * chrome; Fraunces is the editorial serif of the documents themselves (the
 * site's hero document). */
export const SITE_FONTS_IMPORT =
	"@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap');";

export const FARM_LOGO_DATA_URI = svgUri(
	`<circle cx="32" cy="32" r="30" fill="#00a99d"/><path d="M32 14 C40 24 44 32 32 50 C20 32 24 24 32 14 Z" fill="#f4f0e8"/>`,
);

/** Shared root tokens for the demo chartes (site identity). */
export const SITE_CHARTE_TOKENS = [
	"  --charte-color-ink: #101c19;",
	"  --charte-color-paper: #fbfaf6;",
	"  --charte-color-accent: #00a99d;",
	"  --charte-color-accent-light: #a3f2ea;",
	"  --charte-color-muted: #66716d;",
	"  --charte-color-line: rgba(16, 28, 25, 0.16);",
	"  --charte-font-heading: 'Manrope', sans-serif;",
	"  --charte-font-display: 'Fraunces', serif;",
	"  --charte-font-mono: 'DM Mono', monospace;",
];

const greenmarketCharte = siteCharte("greenmarket");

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
			image: { type: "string" },
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
				image: PRODUCT_ICONS.tomato,
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
				image: PRODUCT_ICONS.honey,
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
				image: PRODUCT_ICONS.cheese,
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
				image: PRODUCT_ICONS.bread,
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
				image: PRODUCT_ICONS.cider,
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
				image: PRODUCT_ICONS.oil,
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
		canvas: { w: 90, h: 54, background: "#fbfaf6", format: "custom" },
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

const blankHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:sans-serif;color:#8a8a8a;display:flex;align-items:center;justify-content:center;border:1px dashed #b5b5b5">
  <span data-id="hint" style="font-size:11px">90 × 54 mm — price label</span>
</div>`;

const draftHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:sans-serif;display:flex;flex-direction:column;justify-content:center;padding:5mm;border:1px solid #999">
  <div data-id="name" style="font-size:16px;font-weight:700">{{ name }}</div>
  <div data-id="origin" style="font-size:11px">{{ origin }}</div>
  <div data-id="price" style="font-size:14px;margin-top:2mm">{{ price }} / {{ unit }}</div>
</div>`;

const chartedHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:var(--charte-font-heading);color:var(--charte-color-ink);display:flex;flex-direction:column;padding:4.5mm 5mm;border:1px solid var(--charte-color-ink)">
  <div style="display:flex;align-items:baseline;gap:2.5mm">
    <span data-id="brand" style="font-family:var(--charte-font-mono);font-size:8.5px;letter-spacing:0.22em;color:var(--charte-color-accent)">GREENMARKET · FARM SHOP</span>
    <span data-id="origin" style="margin-left:auto;font-family:var(--charte-font-mono);font-size:8.5px;color:var(--charte-color-muted)">{{ origin }}</span>
  </div>
  <div data-id="name" style="font-size:19px;font-weight:600;letter-spacing:-0.02em;margin-top:3mm;line-height:1.05">{{ name }}</div>
  <div style="margin-top:auto;display:flex;align-items:baseline;gap:2mm;border-top:1px solid var(--charte-color-line);padding-top:2.5mm">
    <span data-id="price" style="font-size:14px;font-weight:600">{{ price }}</span>
    <span data-id="unit" style="font-family:var(--charte-font-mono);font-size:10px;color:var(--charte-color-muted)">/ {{ unit }}</span>
  </div>
</div>`;

const revisedHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:var(--charte-font-heading);color:var(--charte-color-ink);display:flex;flex-direction:column;padding:4.5mm 5mm;border:1px solid var(--charte-color-ink)">
  <div style="display:flex;align-items:center;gap:2.5mm">
    <img data-id="logo" data-name="logo" src="${FARM_LOGO_DATA_URI}" alt="" style="width:6.5mm;height:6.5mm;flex-shrink:0"/>
    <span data-id="brand" style="font-family:var(--charte-font-mono);font-size:8.5px;letter-spacing:0.22em;color:var(--charte-color-accent)">GREENMARKET · FARM SHOP</span>
    <span data-id="origin" style="margin-left:auto;font-family:var(--charte-font-mono);font-size:8.5px;color:var(--charte-color-muted);white-space:nowrap">{{ origin }}</span>
  </div>
  <div data-id="name" style="font-family:var(--charte-font-display);font-size:23px;font-weight:600;line-height:1;margin-top:3mm">{{ name }}</div>
  <div style="margin-top:auto;display:flex;align-items:baseline;gap:2mm;border-top:1px solid var(--charte-color-line);padding-top:2.5mm">
    <span data-id="price" style="font-family:var(--charte-font-mono);font-size:23px">{{ price }}</span>
    <span data-id="unit" style="font-family:var(--charte-font-mono);font-size:10px;color:var(--charte-color-muted)">/ {{ unit }}</span>
    <span style="margin-left:auto;width:6mm;height:1.2mm;background:var(--charte-color-accent)"></span>
  </div>
</div>`;

const illustratedHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:var(--charte-font-heading);color:var(--charte-color-ink);display:flex;gap:4mm;padding:4.5mm 5mm;border:1px solid var(--charte-color-ink)">
  <div style="flex:1;min-width:0;display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;gap:2mm">
      <img data-id="logo" data-name="logo" src="${FARM_LOGO_DATA_URI}" alt="" style="width:6mm;height:6mm;flex-shrink:0"/>
      <span data-id="brand" style="font-family:var(--charte-font-mono);font-size:8px;letter-spacing:0.2em;color:var(--charte-color-accent)">GREENMARKET</span>
    </div>
    <div data-id="name" style="font-family:var(--charte-font-display);font-size:21px;font-weight:600;line-height:1;margin-top:2.5mm">{{ name }}</div>
    <div data-id="origin" style="font-family:var(--charte-font-mono);font-size:8.5px;color:var(--charte-color-muted);margin-top:1.5mm">{{ origin }}</div>
    <div style="margin-top:auto;display:flex;align-items:baseline;gap:2mm;border-top:1px solid var(--charte-color-line);padding-top:2mm">
      <span data-id="price" style="font-family:var(--charte-font-mono);font-size:22px">{{ price }}</span>
      <span data-id="unit" style="font-family:var(--charte-font-mono);font-size:10px;color:var(--charte-color-muted)">/ {{ unit }}</span>
    </div>
  </div>
  <div style="width:17mm;display:flex;align-items:center;justify-content:center;background:rgba(163,242,234,0.25);border:1px solid var(--charte-color-line)">
    <img data-id="photo" data-name="photo" src="${PRODUCE_CRATE}" alt="" style="width:13mm;height:13mm"/>
  </div>
</div>`;

export const productCatalogScenario: DemoScenario = {
	id: "product-catalog",
	title: "Labels + collection",
	downloadName: "product-catalog.maket",
	steps: [
		{
			id: "request",
			actor: "user",
			caption:
				"“Create price labels for my farm shop — here's my product list.”",
			workspace: EMPTY_WORKSPACE,
		},
		{
			id: "page",
			actor: "agent",
			caption: "A label document appears — right format, still empty.",
			workspace: {
				documents: [labelsDoc({ html: blankHtml })],
				chartes: [],
				collections: [],
			},
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
				"The agent revises: serif name, monospace price, logo — a label worth printing.",
			workspace: {
				documents: [labelsDoc({ charte: true, html: revisedHtml })],
				chartes: [greenmarketCharte],
				collections: [],
			},
		},
		{
			id: "collection",
			actor: "agent",
			caption: "Your product list becomes a collection — one row per product.",
			workspace: {
				documents: [
					labelsDoc({ charte: true, html: illustratedHtml, collection: true }),
				],
				chartes: [greenmarketCharte],
				collections: [productsCollection],
			},
			collectionMode: "rendered",
		},
		{
			id: "fan-out",
			actor: "agent",
			caption: "One template, six real labels — data and images per row.",
			collectionMode: "all",
		},
		ownItStep("all"),
	],
};
