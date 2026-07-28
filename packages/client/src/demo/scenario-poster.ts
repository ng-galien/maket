/**
 * Demo scenario 2 — event poster: draft → charte (site identity on dark
 * ink: Manrope display, DM Mono meta, teal accent) → user annotation →
 * revision with artwork, schedule grid and ticket strip.
 */

import type { Document } from "../store/types";
import type { ViewerCharte } from "../viewer/bundle";
import { type DemoScenario, SITE_FONTS_IMPORT } from "./scenario";

export const POSTER_ART_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00a99d"/><stop offset="1" stop-color="#72e2d7"/></linearGradient></defs><circle cx="320" cy="70" r="55" fill="#a3f2ea" opacity="0.9"/><path d="M0 220 Q100 160 200 210 T400 200 V300 H0 Z" fill="url(#g)" opacity="0.45"/><path d="M0 250 Q120 200 240 245 T400 240 V300 H0 Z" fill="url(#g)" opacity="0.85"/></svg>',
)}`;

const midnightCharte: ViewerCharte = {
	name: "midnight-brass",
	css: [
		SITE_FONTS_IMPORT,
		":root {",
		"  --charte-color-bg: #101c19;",
		"  --charte-color-ink: #101c19;",
		"  --charte-color-paper: #fbfaf6;",
		"  --charte-color-accent: #00a99d;",
		"  --charte-color-accent-light: #a3f2ea;",
		"  --charte-color-muted: #72827b;",
		"  --charte-font-heading: 'Manrope', sans-serif;",
		"  --charte-font-mono: 'DM Mono', monospace;",
		"}",
	].join("\n"),
};

function posterDoc(opts: {
	charte?: boolean;
	html: string;
	background?: string;
}): Document {
	return {
		id: "event-poster",
		name: "event-poster",
		category: "poster",
		canvas: {
			w: 210,
			h: 297,
			background: opts.background ?? "#ffffff",
			format: "A4",
		},
		activePage: 0,
		meta: opts.charte ? { charte: "midnight-brass" } : {},
		pages: [{ id: "p1", name: "Poster", elements: [], html: opts.html }],
	};
}

const lineupRows = [
	["20:30", "The Copper Section"],
	["21:45", "Nora Vane Quartet"],
	["23:00", "Balkan Tide"],
	["00:15", "Saint-Louis Brass Band"],
	["01:30", "Late set · DJ Mille-Feuille"],
]
	.map(
		([time, act]) =>
			`<div style="display:flex;align-items:baseline;gap:5mm;border-bottom:1px solid rgba(251,250,246,0.12);padding:2mm 0">
      <span style="font-family:var(--charte-font-mono);font-size:12px;color:var(--charte-color-accent-light)">${time}</span>
      <span style="font-size:15px;font-weight:600">${act}</span>
    </div>`,
	)
	.join("");

const draftHtml = `<div style="padding:18mm 16mm;font-family:sans-serif;color:#222">
  <div data-id="kicker" style="font-size:13px;text-transform:uppercase">Les Docks · Season 12</div>
  <h1 data-id="title" style="font-size:44px;margin:8mm 0 0">Midnight Brass Festival</h1>
  <div data-id="date" style="margin-top:8mm;font-size:18px">Fri 13 – Sun 15 March · 8pm</div>
  <div data-id="lineup" style="margin-top:6mm;font-size:14px;line-height:1.8">The Copper Section · Nora Vane Quartet<br/>Balkan Tide · Saint-Louis Brass Band<br/>Late set: DJ Mille-Feuille</div>
</div>`;

const chartedHtml = `<div style="position:relative;width:100%;height:100%;font-family:var(--charte-font-heading);color:var(--charte-color-paper)">
  <div style="position:relative;padding:16mm 16mm 0">
    <div style="display:flex;align-items:center;gap:4mm">
      <span style="width:7mm;height:7mm;background:var(--charte-color-accent)"></span>
      <span data-id="kicker" style="font-family:var(--charte-font-mono);letter-spacing:0.3em;font-size:12px;color:var(--charte-color-accent-light)">LES DOCKS · SEASON 12</span>
      <span style="flex:1;height:1px;background:rgba(251,250,246,0.25)"></span>
    </div>
    <h1 data-id="title" style="font-size:54px;font-weight:800;letter-spacing:-0.035em;line-height:1;margin:9mm 0 0">Midnight Brass Festival</h1>
    <div data-id="date" style="display:inline-block;margin-top:8mm;font-family:var(--charte-font-mono);font-size:17px;color:var(--charte-color-ink);background:var(--charte-color-accent-light);padding:2mm 4mm">Fri 13 – Sun 15 March · 8pm</div>
    <div data-id="lineup" style="margin-top:8mm">${lineupRows}</div>
  </div>
</div>`;

const revisedHtml = `<div style="position:relative;width:100%;height:100%;overflow:hidden;font-family:var(--charte-font-heading);color:var(--charte-color-paper)">
  <img data-id="art" data-name="artwork" src="${POSTER_ART_DATA_URI}" alt="" style="position:absolute;inset:auto 0 0 0;width:100%"/>
  <div style="position:relative;padding:15mm 16mm 0">
    <div style="display:flex;align-items:center;gap:4mm">
      <span style="width:7mm;height:7mm;background:var(--charte-color-accent)"></span>
      <span data-id="kicker" style="font-family:var(--charte-font-mono);letter-spacing:0.3em;font-size:12px;color:var(--charte-color-accent-light)">LES DOCKS · SEASON 12</span>
      <span style="flex:1;height:1px;background:rgba(251,250,246,0.25)"></span>
    </div>
    <h1 data-id="title" style="font-size:76px;font-weight:800;letter-spacing:-0.035em;line-height:0.92;margin:9mm 0 0">MIDNIGHT<br/>BRASS<br/>FESTIVAL</h1>
    <div data-id="date" style="display:inline-block;margin-top:8mm;font-family:var(--charte-font-mono);font-size:17px;color:var(--charte-color-ink);background:var(--charte-color-accent-light);padding:2mm 4mm">Fri 13 – Sun 15 March · 8pm</div>
    <div data-id="lineup" style="margin-top:7mm;max-width:120mm">${lineupRows}</div>
    <div data-id="tickets" style="margin-top:6mm;display:flex;gap:3mm;align-items:center">
      <span style="font-family:var(--charte-font-mono);font-size:12px;border:1px solid var(--charte-color-accent);color:var(--charte-color-accent-light);padding:1.5mm 3mm">EARLY BIRD 18 €</span>
      <span style="font-family:var(--charte-font-mono);font-size:12px;color:var(--charte-color-muted)">BOX OFFICE 24 €</span>
    </div>
  </div>
  <div data-id="footer" style="position:absolute;left:16mm;right:16mm;bottom:9mm;display:flex;justify-content:space-between;align-items:center;font-family:var(--charte-font-mono);font-size:11px;color:var(--charte-color-ink)">
    <span>QUAI DES DOCKS 12, NANTES</span><span>MIDNIGHTBRASS.EXAMPLE</span>
  </div>
</div>`;

export const eventPosterScenario: DemoScenario = {
	id: "event-poster",
	title: "Event poster",
	downloadName: "event-poster.maket",
	steps: [
		{
			id: "request",
			actor: "user",
			caption: "“I need a poster for our brass festival in March.”",
			workspace: { documents: [], chartes: [], collections: [] },
		},
		{
			id: "draft",
			actor: "agent",
			caption: "The agent lays out the content first — plain, unstyled.",
			workspace: {
				documents: [posterDoc({ html: draftHtml })],
				chartes: [],
				collections: [],
			},
		},
		{
			id: "charte",
			actor: "agent",
			caption:
				"The midnight-brass charte lands: ink, teal and real web fonts, schedule as a grid.",
			workspace: {
				documents: [
					posterDoc({ charte: true, html: chartedHtml, background: "#101c19" }),
				],
				chartes: [midnightCharte],
				collections: [],
			},
		},
		{
			id: "annotate",
			actor: "user",
			caption:
				"You annotate the title: “Bigger. This should hit from across the street.”",
			notes: [{ elementId: "title", text: "Bigger — poster-sized type" }],
		},
		{
			id: "revise",
			actor: "agent",
			caption:
				"Revision: stacked 76px display type, artwork, ticket strip, venue footer.",
			workspace: {
				documents: [
					posterDoc({ charte: true, html: revisedHtml, background: "#101c19" }),
				],
				chartes: [midnightCharte],
				collections: [],
			},
		},
		{
			id: "own-it",
			actor: "info",
			caption:
				"This is a real .maket file — download it and keep working with any agent.",
		},
	],
};
