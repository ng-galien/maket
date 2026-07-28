/**
 * Demo scenario 2 — event poster. Fine-grained journey: content draft →
 * charte → schedule grid arrives → artwork arrives → annotation → display
 * type revision → ticket strip and footer.
 */

import type { Document } from "../store/types";
import type { ViewerCharte } from "../viewer/bundle";
import { POSTER_WAVES } from "./illustrations";
import {
	type DemoScenario,
	SITE_CHARTE_TOKENS,
	SITE_FONTS_IMPORT,
} from "./scenario";

export const POSTER_ART_DATA_URI = POSTER_WAVES;

const midnightCharte: ViewerCharte = {
	name: "midnight-brass",
	css: [
		SITE_FONTS_IMPORT,
		":root {",
		"  --charte-color-bg: #101c19;",
		...SITE_CHARTE_TOKENS,
		"  --charte-color-muted: #72827b;",
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

const kickerRow = `<div style="display:flex;align-items:center;gap:4mm">
      <span style="width:10mm;height:1px;background:var(--charte-color-accent-light)"></span>
      <span data-id="kicker" style="font-family:var(--charte-font-mono);letter-spacing:0.3em;font-size:12px;color:var(--charte-color-accent-light)">LES DOCKS · SEASON 12</span>
      <span style="flex:1;height:1px;background:rgba(251,250,246,0.25)"></span>
    </div>`;

const dateChip = `<div data-id="date" style="display:inline-block;margin-top:9mm;font-family:var(--charte-font-mono);font-size:16px;color:var(--charte-color-ink);background:var(--charte-color-accent-light);border-radius:999px;padding:2mm 5mm">Fri 13 – Sun 15 March · 8pm</div>`;

const artImg = `<img data-id="art" data-name="artwork" src="${POSTER_ART_DATA_URI}" alt="" style="position:absolute;inset:auto 0 0 0;width:100%"/>`;

const draftHtml = `<div style="padding:18mm 16mm;font-family:sans-serif;color:#222">
  <div data-id="kicker" style="font-size:13px;text-transform:uppercase">Les Docks · Season 12</div>
  <h1 data-id="title" style="font-size:44px;margin:8mm 0 0">Midnight Brass Festival</h1>
  <div data-id="date" style="margin-top:8mm;font-size:18px">Fri 13 – Sun 15 March · 8pm</div>
  <div data-id="lineup" style="margin-top:6mm;font-size:14px;line-height:1.8">The Copper Section · Nora Vane Quartet<br/>Balkan Tide · Saint-Louis Brass Band<br/>Late set: DJ Mille-Feuille</div>
</div>`;

const posterShell = (inner: string, withArt = false) =>
	`<div style="position:relative;width:100%;height:100%;overflow:hidden;font-family:var(--charte-font-heading);color:var(--charte-color-paper)">
  ${withArt ? artImg : ""}
  <div style="position:relative;padding:15mm 16mm 0">${inner}</div>
</div>`;

const chartedHtml = posterShell(`${kickerRow}
    <h1 data-id="title" style="font-family:var(--charte-font-display);font-size:54px;font-weight:500;line-height:1.05;margin:9mm 0 0">Midnight Brass Festival</h1>
    ${dateChip}`);

const lineupHtml = posterShell(`${kickerRow}
    <h1 data-id="title" style="font-family:var(--charte-font-display);font-size:54px;font-weight:500;line-height:1.05;margin:9mm 0 0">Midnight Brass Festival</h1>
    ${dateChip}
    <div data-id="lineup" style="margin-top:8mm;max-width:118mm">${lineupRows}</div>`);

const artHtml = posterShell(
	`${kickerRow}
    <h1 data-id="title" style="font-family:var(--charte-font-display);font-size:54px;font-weight:500;line-height:1.05;margin:9mm 0 0">Midnight Brass Festival</h1>
    ${dateChip}
    <div data-id="lineup" style="margin-top:8mm;max-width:118mm">${lineupRows}</div>`,
	true,
);

const bigTitle = `<h1 data-id="title" style="font-family:var(--charte-font-display);font-size:74px;font-weight:500;line-height:0.98;margin:10mm 0 0">MIDNIGHT<br/>BRASS<br/>FESTIVAL</h1>`;

const revisedHtml = posterShell(
	`${kickerRow}
    ${bigTitle}
    ${dateChip}
    <div data-id="lineup" style="margin-top:8mm;max-width:118mm">${lineupRows}</div>`,
	true,
);

const finalHtml = `<div style="position:relative;width:100%;height:100%;overflow:hidden;font-family:var(--charte-font-heading);color:var(--charte-color-paper)">
  ${artImg}
  <div style="position:relative;padding:15mm 16mm 0">
    ${kickerRow}
    ${bigTitle}
    ${dateChip}
    <div data-id="lineup" style="margin-top:8mm;max-width:118mm">${lineupRows}</div>
    <div data-id="tickets" style="margin-top:7mm;display:flex;gap:3mm;align-items:center">
      <span style="font-family:var(--charte-font-mono);font-size:12px;border:1px solid rgba(251,250,246,0.35);border-radius:999px;color:var(--charte-color-paper);padding:1.5mm 4mm">EARLY BIRD 18 €</span>
      <span style="font-family:var(--charte-font-mono);font-size:12px;color:var(--charte-color-muted)">BOX OFFICE 24 €</span>
    </div>
  </div>
  <div data-id="footer" style="position:absolute;left:16mm;right:16mm;bottom:9mm;display:flex;justify-content:space-between;align-items:center;font-family:var(--charte-font-mono);font-size:11px;color:var(--charte-color-muted)">
    <span>QUAI DES DOCKS 12, NANTES</span><span>MIDNIGHTBRASS.EXAMPLE</span>
  </div>
</div>`;

const ink = (html: string) => ({
	documents: [posterDoc({ charte: true, html, background: "#101c19" })],
	chartes: [midnightCharte],
	collections: [],
});

export const eventPosterScenario: DemoScenario = {
	id: "event-poster",
	title: "Poster",
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
				"The midnight-brass charte lands: ink, serif display, mono details.",
			workspace: ink(chartedHtml),
		},
		{
			id: "lineup",
			actor: "agent",
			caption: "The schedule arrives as a timed grid, act by act.",
			workspace: ink(lineupHtml),
		},
		{
			id: "artwork",
			actor: "agent",
			caption: "Artwork joins: teal night tide and a mint moon.",
			workspace: ink(artHtml),
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
			caption: "Revision: stacked 74px display type.",
			workspace: ink(revisedHtml),
		},
		{
			id: "finish",
			actor: "agent",
			caption: "Finishing touches: ticket strip and venue footer.",
			workspace: ink(finalHtml),
		},
		{
			id: "own-it",
			actor: "info",
			caption:
				"This is a real .maket file — download it and keep working with any agent.",
		},
	],
};
