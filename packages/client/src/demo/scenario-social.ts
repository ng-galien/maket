/**
 * Demo scenario 5 — social announcement series. A second collection
 * showcase: one square card template, one row per festival act, fanned out
 * into a ready-to-post series.
 */

import type { Collection } from "@maket/shared";
import type { Document } from "../store/types";
import type { ViewerCharte } from "../viewer/bundle";
import { TRUMPET_MARK } from "./illustrations";
import {
	type DemoScenario,
	SITE_CHARTE_TOKENS,
	SITE_FONTS_IMPORT,
} from "./scenario";

const socialCharte: ViewerCharte = {
	name: "midnight-social",
	css: [
		SITE_FONTS_IMPORT,
		":root {",
		"  --charte-color-bg: #101c19;",
		...SITE_CHARTE_TOKENS,
		"  --charte-color-muted: #72827b;",
		"}",
	].join("\n"),
};

const announcements: Collection = {
	name: "announcements",
	description: "One post per festival act",
	schema: {
		type: "object",
		properties: {
			act: { type: "string" },
			day: { type: "string" },
			time: { type: "string" },
			tag: { type: "string" },
		},
		required: ["act", "day", "time", "tag"],
	},
	members: [
		{
			id: "a1",
			position: 1,
			data: {
				act: "The Copper Section",
				day: "Friday 13",
				time: "20:30",
				tag: "Opening night",
			},
		},
		{
			id: "a2",
			position: 2,
			data: {
				act: "Nora Vane Quartet",
				day: "Friday 13",
				time: "21:45",
				tag: "Modern jazz",
			},
		},
		{
			id: "a3",
			position: 3,
			data: {
				act: "Balkan Tide",
				day: "Saturday 14",
				time: "23:00",
				tag: "Brass fanfare",
			},
		},
		{
			id: "a4",
			position: 4,
			data: {
				act: "DJ Mille-Feuille",
				day: "Sunday 15",
				time: "01:30",
				tag: "Late set",
			},
		},
	],
};

function postDoc(opts: {
	charte?: boolean;
	html: string;
	collection?: boolean;
}): Document {
	return {
		id: "launch-posts",
		name: "launch-posts",
		category: "social",
		canvas: { w: 108, h: 108, background: "#101c19", format: "custom" },
		activePage: 0,
		meta: opts.charte ? { charte: "midnight-social" } : {},
		pages: [
			{
				id: "p1",
				name: "Post",
				elements: [],
				...(opts.collection ? { collection: { name: "announcements" } } : {}),
				html: opts.html,
			},
		],
	};
}

const draftHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:sans-serif;color:#f0f0f0;background:#333;display:flex;flex-direction:column;justify-content:center;padding:10mm">
  <div style="font-size:11px;text-transform:uppercase">Midnight Brass Festival</div>
  <div data-id="act" style="font-size:24px;font-weight:700;margin-top:4mm">{{ act }}</div>
  <div data-id="when" style="font-size:13px;margin-top:3mm">{{ day }} · {{ time }}</div>
</div>`;

const chartedHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:var(--charte-font-heading);color:var(--charte-color-paper);display:flex;flex-direction:column;padding:9mm;border:1px solid rgba(163,242,234,0.5);outline:1px solid rgba(163,242,234,0.2);outline-offset:-3mm">
  <div style="display:flex;align-items:center;gap:3mm">
    <span style="width:6mm;height:1px;background:var(--charte-color-accent-light)"></span>
    <span data-id="brand" style="font-family:var(--charte-font-mono);font-size:9px;letter-spacing:0.28em;color:var(--charte-color-accent-light)">MIDNIGHT BRASS</span>
  </div>
  <div data-id="act" style="font-family:var(--charte-font-display);font-size:27px;font-weight:500;line-height:1.02;margin-top:auto">{{ act }}</div>
  <div data-id="tag" style="font-family:var(--charte-font-mono);font-size:10px;color:var(--charte-color-muted);margin-top:2mm">{{ tag }}</div>
  <div data-id="when" style="margin-top:5mm;font-family:var(--charte-font-mono);font-size:11px;color:var(--charte-color-ink);background:var(--charte-color-accent-light);border-radius:999px;padding:1.5mm 3.5mm;align-self:flex-start">{{ day }} · {{ time }}</div>
</div>`;

const revisedHtml = `<div style="width:100%;height:100%;box-sizing:border-box;font-family:var(--charte-font-heading);color:var(--charte-color-paper);display:flex;flex-direction:column;padding:9mm;border:1px solid rgba(163,242,234,0.5);outline:1px solid rgba(163,242,234,0.2);outline-offset:-3mm;position:relative;overflow:hidden">
  <img data-id="mark" data-name="mark" src="${TRUMPET_MARK}" alt="" style="position:absolute;right:6mm;top:6mm;width:16mm;height:16mm;opacity:0.9"/>
  <div style="display:flex;align-items:center;gap:3mm">
    <span style="width:6mm;height:1px;background:var(--charte-color-accent-light)"></span>
    <span data-id="brand" style="font-family:var(--charte-font-mono);font-size:9px;letter-spacing:0.28em;color:var(--charte-color-accent-light)">MIDNIGHT BRASS</span>
  </div>
  <div data-id="act" style="font-family:var(--charte-font-display);font-size:27px;font-weight:500;line-height:1.02;margin-top:auto">{{ act }}</div>
  <div data-id="tag" style="font-family:var(--charte-font-mono);font-size:10px;color:var(--charte-color-muted);margin-top:2mm">{{ tag }}</div>
  <div style="margin-top:5mm;display:flex;align-items:center;gap:2.5mm">
    <span data-id="when" style="font-family:var(--charte-font-mono);font-size:11px;color:var(--charte-color-ink);background:var(--charte-color-accent-light);border-radius:999px;padding:1.5mm 3.5mm">{{ day }} · {{ time }}</span>
    <span data-id="venue" style="font-family:var(--charte-font-mono);font-size:9px;color:var(--charte-color-muted)">LES DOCKS, NANTES</span>
  </div>
</div>`;

export const socialSeriesScenario: DemoScenario = {
	id: "social-series",
	title: "Social series",
	downloadName: "social-series.maket",
	steps: [
		{
			id: "request",
			actor: "user",
			caption: "“One announcement post per act — same look, square format.”",
			workspace: { documents: [], chartes: [], collections: [] },
		},
		{
			id: "draft",
			actor: "agent",
			caption: "A square post template appears — plain first.",
			workspace: {
				documents: [postDoc({ html: draftHtml })],
				chartes: [],
				collections: [],
			},
		},
		{
			id: "charte",
			actor: "agent",
			caption:
				"The festival charte: ink, mint frame, serif act name, mono details.",
			workspace: {
				documents: [postDoc({ charte: true, html: chartedHtml })],
				chartes: [socialCharte],
				collections: [],
			},
		},
		{
			id: "collection",
			actor: "agent",
			caption: "The line-up becomes a collection — one row per act.",
			workspace: {
				documents: [
					postDoc({ charte: true, html: chartedHtml, collection: true }),
				],
				chartes: [socialCharte],
				collections: [announcements],
			},
			collectionMode: "rendered",
		},
		{
			id: "annotate",
			actor: "user",
			caption: "You annotate: “Add the venue, and a small brass mark.”",
			notes: [{ elementId: "when", text: "Add the venue and a brass mark" }],
		},
		{
			id: "revise",
			actor: "agent",
			caption: "Revision: trumpet mark and venue line join the card.",
			workspace: {
				documents: [
					postDoc({ charte: true, html: revisedHtml, collection: true }),
				],
				chartes: [socialCharte],
				collections: [announcements],
			},
			collectionMode: "rendered",
		},
		{
			id: "fan-out",
			actor: "agent",
			caption: "Four acts, four ready-to-post cards — one template.",
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
