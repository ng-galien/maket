/**
 * Demo scenario 3 — app wireframe: one screen grows into a three-screen
 * flow. Shows multi-page documents and iteration on structure rather than
 * styling.
 */

import type { Document, Page } from "../store/types";
import type { ViewerCharte } from "../viewer/bundle";
import type { DemoScenario } from "./scenario";

const inkCharte: ViewerCharte = {
	name: "wireframe-ink",
	css: [
		":root {",
		"  --charte-color-bg: #fbfbfd;",
		"  --charte-color-primary: #3b6ef6;",
		"  --charte-color-text: #22242c;",
		"  --charte-color-line: #c9cdd8;",
		"  --charte-font-body: system-ui, sans-serif;",
		"}",
	].join("\n"),
};

const box = (extra = "") =>
	`border:1.5px dashed var(--charte-color-line);border-radius:8px;${extra}`;

const screen = (title: string, inner: string) =>
	`<div style="width:100%;height:100%;font-family:var(--charte-font-body);color:var(--charte-color-text);display:flex;flex-direction:column">
  <div data-id="statusbar" style="height:8mm"></div>
  <div data-id="header" style="display:flex;align-items:center;justify-content:space-between;padding:0 6mm 4mm">
    <span style="font-size:18px;font-weight:700">${title}</span>
    <span style="width:9mm;height:9mm;${box("border-radius:50%")}"></span>
  </div>
  <div style="flex:1;padding:0 6mm;display:flex;flex-direction:column;gap:4mm">${inner}</div>
  <div data-id="tabbar" style="display:flex;justify-content:space-around;padding:4mm 0 6mm">
    ${["Home", "Search", "Cart", "Me"].map((t) => `<span style="font-size:11px;color:var(--charte-color-line)">${t}</span>`).join("")}
  </div>
</div>`;

const card = (id: string, h: string) =>
	`<div data-id="${id}" style="${box(`height:${h}`)};display:flex;align-items:center;gap:4mm;padding:0 4mm">
    <span style="width:12mm;height:12mm;${box()};flex-shrink:0"></span>
    <span style="flex:1"><span style="display:block;height:3mm;width:70%;background:var(--charte-color-line);border-radius:2px"></span>
    <span style="display:block;height:2.5mm;width:45%;background:var(--charte-color-line);opacity:0.5;border-radius:2px;margin-top:2mm"></span></span>
  </div>`;

const onboarding: Page = {
	id: "s1",
	name: "Onboarding",
	elements: [],
	html: screen(
		"Welcome",
		`<div data-id="hero" style="${box("height:52mm")};display:flex;align-items:center;justify-content:center;color:var(--charte-color-line)">Illustration</div>
     <div data-id="pitch" style="text-align:center;font-size:14px;line-height:1.5">Fresh produce,<br/>delivered before breakfast.</div>
     <div data-id="cta" style="margin-top:auto;background:var(--charte-color-primary);color:#fff;border-radius:10px;text-align:center;padding:4mm;font-weight:600">Get started</div>`,
	),
};

const onboardingRevised: Page = {
	...onboarding,
	html: screen(
		"Welcome",
		`<div data-id="hero" style="${box("height:52mm")};display:flex;align-items:center;justify-content:center;color:var(--charte-color-line)">Illustration</div>
     <div data-id="pitch" style="text-align:center;font-size:14px;line-height:1.5">Fresh produce,<br/>delivered before breakfast.</div>
     <div data-id="social" style="${box("height:10mm")};display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--charte-color-line)">Continue with Apple / Google</div>
     <div data-id="cta" style="margin-top:auto;background:var(--charte-color-primary);color:#fff;border-radius:10px;text-align:center;padding:4mm;font-weight:600">Get started</div>`,
	),
};

const catalog: Page = {
	id: "s2",
	name: "Catalog",
	elements: [],
	html: screen(
		"Market",
		`<div data-id="search" style="${box("height:10mm")};display:flex;align-items:center;padding:0 4mm;color:var(--charte-color-line)">Search…</div>
     ${card("item1", "18mm")}${card("item2", "18mm")}${card("item3", "18mm")}${card("item4", "18mm")}`,
	),
};

const checkout: Page = {
	id: "s3",
	name: "Checkout",
	elements: [],
	html: screen(
		"Your basket",
		`${card("line1", "16mm")}${card("line2", "16mm")}
     <div data-id="total" style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-top:2mm"><span>Total</span><span>24,90 €</span></div>
     <div data-id="pay" style="margin-top:auto;background:var(--charte-color-primary);color:#fff;border-radius:10px;text-align:center;padding:4mm;font-weight:600">Pay now</div>`,
	),
};

function wireDoc(pages: Page[]): Document {
	return {
		id: "app-wireframe",
		name: "app-wireframe",
		category: "wireframe",
		canvas: { w: 90, h: 195, background: "#fbfbfd", format: "custom" },
		activePage: 0,
		meta: { charte: "wireframe-ink" },
		pages,
	};
}

export const appWireframeScenario: DemoScenario = {
	id: "app-wireframe",
	title: "Mobile app wireframe",
	downloadName: "app-wireframe.maket",
	steps: [
		{
			id: "request",
			actor: "user",
			caption:
				"“Wireframe a grocery-delivery app: onboarding, catalog, checkout.”",
			workspace: { documents: [], chartes: [], collections: [] },
		},
		{
			id: "first-screen",
			actor: "agent",
			caption: "The agent starts with the onboarding screen.",
			workspace: {
				documents: [wireDoc([onboarding])],
				chartes: [inkCharte],
				collections: [],
			},
		},
		{
			id: "annotate",
			actor: "user",
			caption: "You annotate: “Add social sign-in options here.”",
			notes: [{ elementId: "cta", text: "Add social sign-in options" }],
		},
		{
			id: "revise",
			actor: "agent",
			caption: "Revision: Apple/Google sign-in slots in above the CTA.",
			workspace: {
				documents: [wireDoc([onboardingRevised])],
				chartes: [inkCharte],
				collections: [],
			},
		},
		{
			id: "grow",
			actor: "agent",
			caption:
				"The flow grows: catalog and checkout join as pages of the same document.",
			workspace: {
				documents: [wireDoc([onboardingRevised, catalog, checkout])],
				chartes: [inkCharte],
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
