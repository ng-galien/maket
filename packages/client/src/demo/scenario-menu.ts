/**
 * Demo scenario 4 — bistro menu. An A4 editorial document built section by
 * section: masthead → charte → starters → mains → desserts and wines →
 * annotation on price scanning → dotted-leader revision → illustration.
 */

import type { Document } from "../store/types";
import { MENU_PLATE } from "./illustrations";
import {
	type DemoScenario,
	EMPTY_WORKSPACE,
	ownItStep,
	siteCharte,
} from "./scenario";

const bistroCharte = siteCharte("chez-lucette");

function menuDoc(opts: { charte?: boolean; html: string }): Document {
	return {
		id: "bistro-menu",
		name: "bistro-menu",
		category: "menu",
		canvas: { w: 210, h: 297, background: "#fbfaf6", format: "A4" },
		activePage: 0,
		meta: opts.charte ? { charte: "chez-lucette" } : {},
		pages: [{ id: "m1", name: "Menu", elements: [], html: opts.html }],
	};
}

interface MenuItem {
	name: string;
	desc: string;
	price: string;
}

const STARTERS: MenuItem[] = [
	{ name: "Leek vinaigrette", desc: "soft egg, hazelnuts", price: "9 €" },
	{ name: "Smoked trout rillettes", desc: "sourdough toast", price: "11 €" },
	{ name: "Autumn squash soup", desc: "brown butter, sage", price: "8 €" },
];
const MAINS: MenuItem[] = [
	{ name: "Roast chicken for two", desc: "jus, confit garlic", price: "38 €" },
	{ name: "Catch of the day", desc: "beurre blanc, leeks", price: "24 €" },
	{ name: "Celeriac schnitzel", desc: "caper butter, cress", price: "19 €" },
	{ name: "Steak frites", desc: "peppercorn sauce", price: "26 €" },
];
const DESSERTS: MenuItem[] = [
	{ name: "Paris-Brest", desc: "praline cream", price: "10 €" },
	{ name: "Poached pear", desc: "verbena, almond", price: "9 €" },
	{ name: "Dark chocolate tart", desc: "fleur de sel", price: "9 €" },
];

const item = (entry: MenuItem, leaders: boolean) =>
	leaders
		? `<div style="display:flex;align-items:baseline;gap:2mm;margin-top:3mm">
        <span style="font-weight:600;font-size:14px;white-space:nowrap">${entry.name}</span>
        <span style="flex:1;border-bottom:1.5px dotted var(--charte-color-line);transform:translateY(-1mm)"></span>
        <span style="font-family:var(--charte-font-mono);font-size:13px;white-space:nowrap">${entry.price}</span>
      </div>
      <div style="font-size:11.5px;color:var(--charte-color-muted);margin-top:0.5mm">${entry.desc}</div>`
		: `<div style="margin-top:3mm">
        <span style="font-weight:600;font-size:14px">${entry.name} <span style="font-family:var(--charte-font-mono);font-size:12px">— ${entry.price}</span></span>
        <div style="font-size:11.5px;color:var(--charte-color-muted);margin-top:0.5mm">${entry.desc}</div>
      </div>`;

const section = (
	id: string,
	title: string,
	items: MenuItem[],
	leaders: boolean,
) =>
	`<div data-id="${id}" style="margin-top:9mm">
    <div style="display:flex;align-items:center;gap:4mm">
      <span style="font-family:var(--charte-font-mono);font-size:11px;letter-spacing:0.25em;color:var(--charte-color-accent)">${title}</span>
      <span style="flex:1;height:1px;background:var(--charte-color-line)"></span>
    </div>
    ${items.map((entry) => item(entry, leaders)).join("\n    ")}
  </div>`;

const masthead = (withArt: boolean) =>
	`<div data-id="masthead" style="text-align:center">
    ${withArt ? `<img data-id="plate" data-name="plate" src="${MENU_PLATE}" alt="" style="width:52mm;margin:0 auto 4mm;display:block"/>` : ""}
    <div style="font-family:var(--charte-font-mono);font-size:11px;letter-spacing:0.3em;color:var(--charte-color-accent)">BISTROT · DEPUIS 1987</div>
    <h1 data-id="title" style="font-family:var(--charte-font-display);font-size:46px;font-weight:500;margin:4mm 0 0">Chez Lucette</h1>
    <div style="width:16mm;height:1px;background:var(--charte-color-ink);margin:5mm auto 0"></div>
  </div>`;

const wines = `<div data-id="wines" style="margin-top:9mm;border-top:1px solid var(--charte-color-line);padding-top:5mm;display:flex;justify-content:space-between;font-family:var(--charte-font-mono);font-size:11px;color:var(--charte-color-muted)">
    <span>NATURAL WINES BY THE GLASS — 6/8 €</span><span>MENU DU MIDI 21 €</span>
  </div>`;

const shell = (inner: string) =>
	`<div style="width:100%;height:100%;box-sizing:border-box;font-family:var(--charte-font-heading);color:var(--charte-color-ink);padding:16mm 20mm">${inner}</div>`;

const draftMastheadHtml = `<div style="padding:18mm;font-family:sans-serif;color:#222;text-align:center">
  <div data-id="masthead" style="font-size:12px;text-transform:uppercase">Bistrot · depuis 1987</div>
  <h1 data-id="title" style="font-size:34px;margin:6mm 0 0">Chez Lucette</h1>
</div>`;

const chartedHtml = shell(masthead(false));
const startersHtml = shell(
	`${masthead(false)}${section("starters", "TO START", STARTERS, false)}`,
);
const mainsHtml = shell(
	`${masthead(false)}${section("starters", "TO START", STARTERS, false)}${section("mains", "MAINS", MAINS, false)}`,
);
const dessertsHtml = shell(
	`${masthead(false)}${section("starters", "TO START", STARTERS, false)}${section("mains", "MAINS", MAINS, false)}${section("desserts", "DESSERTS", DESSERTS, false)}${wines}`,
);
const leadersHtml = shell(
	`${masthead(false)}${section("starters", "TO START", STARTERS, true)}${section("mains", "MAINS", MAINS, true)}${section("desserts", "DESSERTS", DESSERTS, true)}${wines}`,
);
const finalHtml = shell(
	`${masthead(true)}${section("starters", "TO START", STARTERS, true)}${section("mains", "MAINS", MAINS, true)}${section("desserts", "DESSERTS", DESSERTS, true)}${wines}`,
);

const paper = (html: string) => ({
	documents: [menuDoc({ charte: true, html })],
	chartes: [bistroCharte],
	collections: [],
});

export const bistroMenuScenario: DemoScenario = {
	id: "bistro-menu",
	title: "Menu",
	downloadName: "bistro-menu.maket",
	steps: [
		{
			id: "request",
			actor: "user",
			caption: "“A menu for my bistro — starters, mains, desserts, our wines.”",
			workspace: EMPTY_WORKSPACE,
		},
		{
			id: "masthead",
			actor: "agent",
			caption: "An A4 page opens with a plain masthead.",
			workspace: {
				documents: [menuDoc({ html: draftMastheadHtml })],
				chartes: [],
				collections: [],
			},
		},
		{
			id: "charte",
			actor: "agent",
			caption:
				"The house charte lands: serif masthead, mono eyebrow, ink rule.",
			workspace: paper(chartedHtml),
		},
		{
			id: "starters",
			actor: "agent",
			caption: "First section: starters, with descriptions and prices.",
			workspace: paper(startersHtml),
		},
		{
			id: "mains",
			actor: "agent",
			caption: "Mains follow — four dishes.",
			workspace: paper(mainsHtml),
		},
		{
			id: "desserts",
			actor: "agent",
			caption: "Desserts, and the wine line closes the page.",
			workspace: paper(dessertsHtml),
		},
		{
			id: "annotate",
			actor: "user",
			caption: "You annotate the mains: “Prices are hard to scan.”",
			notes: [{ elementId: "mains", text: "Prices are hard to scan" }],
		},
		{
			id: "leaders",
			actor: "agent",
			caption:
				"Revision: dotted leaders align every price on the right margin.",
			workspace: paper(leadersHtml),
		},
		{
			id: "illustration",
			actor: "agent",
			caption: "A line-art plate tops the masthead.",
			workspace: paper(finalHtml),
		},
		ownItStep(),
	],
};
