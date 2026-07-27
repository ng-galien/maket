/**
 * Demo scenario 2 — event poster: draft → charte (dark palette + display
 * type) → user annotation → revision with artwork. No collection; this one
 * shows the charte/annotation/revision arc on a single striking page.
 */

import type { Document } from "../store/types";
import type { ViewerCharte } from "../viewer/bundle";
import type { DemoScenario } from "./scenario";

const POSTER_ART_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2a33c"/><stop offset="1" stop-color="#c85a19"/></linearGradient></defs><circle cx="320" cy="80" r="60" fill="url(#g)" opacity="0.9"/><path d="M0 220 Q100 160 200 210 T400 200 V300 H0 Z" fill="url(#g)" opacity="0.55"/><path d="M0 250 Q120 200 240 245 T400 240 V300 H0 Z" fill="url(#g)" opacity="0.8"/></svg>',
)}`;

const midnightCharte: ViewerCharte = {
	name: "midnight-brass",
	css: [
		"@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;600&display=swap');",
		":root {",
		"  --charte-color-bg: #101423;",
		"  --charte-color-primary: #f2a33c;",
		"  --charte-color-text: #f4efe6;",
		"  --charte-color-muted: #8a90a6;",
		"  --charte-font-heading: 'Archivo Black', sans-serif;",
		"  --charte-font-body: 'Archivo', sans-serif;",
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

const draftHtml = `<div style="padding:18mm 16mm;font-family:sans-serif;color:#222">
  <div data-id="kicker" style="font-size:13px;text-transform:uppercase">Les Docks · Season 12</div>
  <h1 data-id="title" style="font-size:44px;margin:8mm 0 0">Midnight Brass Festival</h1>
  <div data-id="date" style="margin-top:8mm;font-size:18px">Fri 13 – Sun 15 March · 8pm</div>
  <div data-id="lineup" style="margin-top:6mm;font-size:14px;line-height:1.8">The Copper Section · Nora Vane Quartet<br/>Balkan Tide · Saint-Louis Brass Band<br/>Late set: DJ Mille-Feuille</div>
</div>`;

const chartedHtml = `<div style="position:relative;width:100%;height:100%;font-family:var(--charte-font-body);color:var(--charte-color-text)">
  <div style="position:relative;padding:18mm 16mm 0">
    <div data-id="kicker" style="letter-spacing:0.35em;font-size:13px;color:var(--charte-color-primary);text-transform:uppercase">Les Docks · Season 12</div>
    <h1 data-id="title" style="font-family:var(--charte-font-heading);font-size:52px;line-height:1;margin:8mm 0 0">Midnight Brass Festival</h1>
    <div data-id="date" style="margin-top:10mm;font-size:22px;font-weight:600;color:var(--charte-color-primary)">Fri 13 – Sun 15 March · 8pm</div>
    <div data-id="lineup" style="margin-top:8mm;font-size:15px;line-height:1.9;color:var(--charte-color-muted)">The Copper Section · Nora Vane Quartet<br/>Balkan Tide · Saint-Louis Brass Band<br/>Late set: DJ Mille-Feuille</div>
  </div>
</div>`;

const revisedHtml = `<div style="position:relative;width:100%;height:100%;overflow:hidden;font-family:var(--charte-font-body);color:var(--charte-color-text)">
  <img data-id="art" data-name="artwork" src="${POSTER_ART_DATA_URI}" alt="" style="position:absolute;inset:auto 0 0 0;width:100%;opacity:0.9"/>
  <div style="position:relative;padding:18mm 16mm 0">
    <div data-id="kicker" style="letter-spacing:0.35em;font-size:13px;color:var(--charte-color-primary);text-transform:uppercase">Les Docks · Season 12</div>
    <h1 data-id="title" style="font-family:var(--charte-font-heading);font-size:76px;line-height:0.95;margin:8mm 0 0">MIDNIGHT<br/>BRASS<br/>FESTIVAL</h1>
    <div data-id="date" style="margin-top:10mm;font-size:22px;font-weight:600;color:var(--charte-color-primary)">Fri 13 – Sun 15 March · 8pm</div>
    <div data-id="lineup" style="margin-top:8mm;font-size:15px;line-height:1.9;color:var(--charte-color-muted)">The Copper Section · Nora Vane Quartet<br/>Balkan Tide · Saint-Louis Brass Band<br/>Late set: DJ Mille-Feuille</div>
  </div>
  <div data-id="footer" style="position:absolute;left:16mm;right:16mm;bottom:10mm;display:flex;justify-content:space-between;font-size:12px;color:var(--charte-color-muted)">
    <span>Quai des Docks 12, Nantes</span><span>midnightbrass.example</span>
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
				"The midnight-brass charte lands: dark palette, display typography, real web fonts.",
			workspace: {
				documents: [
					posterDoc({ charte: true, html: chartedHtml, background: "#101423" }),
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
				"Revision: stacked 76px display type, brass artwork, venue footer.",
			workspace: {
				documents: [
					posterDoc({ charte: true, html: revisedHtml, background: "#101423" }),
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
