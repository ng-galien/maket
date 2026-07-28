/**
 * Demo scenario 3 — app wireframe: one screen grows into a three-screen
 * flow. Site identity on paper-light: Manrope, DM Mono prices, teal
 * primary, ink lines.
 */

import type { Document, Page } from "../store/types";
import type { ViewerCharte } from "../viewer/bundle";
import { type DemoScenario, SITE_FONTS_IMPORT } from "./scenario";

const inkCharte: ViewerCharte = {
	name: "wireframe-ink",
	css: [
		SITE_FONTS_IMPORT,
		":root {",
		"  --charte-color-bg: #fbfaf6;",
		"  --charte-color-ink: #101c19;",
		"  --charte-color-accent: #00a99d;",
		"  --charte-color-muted: #66716d;",
		"  --charte-color-line: rgba(16, 28, 25, 0.16);",
		"  --charte-font-heading: 'Manrope', sans-serif;",
		"  --charte-font-mono: 'DM Mono', monospace;",
		"}",
	].join("\n"),
};

const box = (extra = "") =>
	`border:1.5px dashed var(--charte-color-line);border-radius:8px;${extra}`;

const screen = (title: string, inner: string) =>
	`<div style="width:100%;height:100%;font-family:var(--charte-font-heading);color:var(--charte-color-ink);display:flex;flex-direction:column">
  <div data-id="statusbar" style="display:flex;justify-content:space-between;align-items:center;padding:3mm 6mm 0;font-family:var(--charte-font-mono);font-size:10px;color:var(--charte-color-muted)"><span>9:41</span><span>●●●</span></div>
  <div data-id="header" style="display:flex;align-items:center;justify-content:space-between;padding:3mm 6mm 4mm">
    <span style="font-size:19px;font-weight:800;letter-spacing:-0.02em">${title}</span>
    <span style="width:9mm;height:9mm;${box("border-radius:50%")}"></span>
  </div>
  <div style="flex:1;padding:0 6mm;display:flex;flex-direction:column;gap:3.5mm;overflow:hidden">${inner}</div>
  <div data-id="tabbar" style="display:flex;justify-content:space-around;border-top:1px solid var(--charte-color-line);padding:3.5mm 0 5mm;font-size:11px;font-weight:600">
    <span style="color:var(--charte-color-accent)">Home</span>
    ${["Search", "Cart", "Me"].map((t) => `<span style="color:var(--charte-color-muted)">${t}</span>`).join("")}
  </div>
</div>`;

const chips = `<div data-id="chips" style="display:flex;gap:2mm">
  <span style="background:var(--charte-color-accent);color:#fff;border-radius:999px;padding:1.5mm 3mm;font-size:11px;font-weight:700">All</span>
  ${["Veggies", "Dairy", "Bakery", "Drinks"].map((c) => `<span style="border:1px solid var(--charte-color-line);border-radius:999px;padding:1.5mm 3mm;font-size:11px;color:var(--charte-color-muted)">${c}</span>`).join("")}
</div>`;

const card = (id: string, name: string, price: string) =>
	`<div data-id="${id}" style="${box("height:17mm")};display:flex;align-items:center;gap:4mm;padding:0 4mm">
    <span style="width:11mm;height:11mm;${box()};flex-shrink:0"></span>
    <span style="flex:1;min-width:0">
      <span style="display:block;font-size:13px;font-weight:700">${name}</span>
      <span style="display:block;height:2.5mm;width:55%;background:var(--charte-color-line);border-radius:2px;margin-top:1.5mm"></span>
    </span>
    <span style="font-family:var(--charte-font-mono);font-size:13px;color:var(--charte-color-accent);flex-shrink:0">${price}</span>
  </div>`;

const basketRow = (name: string, qty: string, price: string) =>
	`<div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--charte-color-line);padding:2mm 0">
    <span style="font-size:13px;font-weight:600">${name} <span style="font-family:var(--charte-font-mono);font-size:10px;color:var(--charte-color-muted)">× ${qty}</span></span>
    <span style="font-family:var(--charte-font-mono);font-size:13px">${price}</span>
  </div>`;

const onboarding: Page = {
	id: "s1",
	name: "Onboarding",
	elements: [],
	html: screen(
		"Welcome",
		`<div data-id="hero" style="${box("height:48mm")};display:flex;align-items:center;justify-content:center;color:var(--charte-color-muted)">Illustration</div>
     <div data-id="dots" style="display:flex;justify-content:center;gap:1.5mm"><span style="width:5mm;height:1.5mm;border-radius:999px;background:var(--charte-color-accent)"></span><span style="width:1.5mm;height:1.5mm;border-radius:50%;background:var(--charte-color-line)"></span><span style="width:1.5mm;height:1.5mm;border-radius:50%;background:var(--charte-color-line)"></span></div>
     <div data-id="pitch" style="text-align:center;font-size:15px;font-weight:600;line-height:1.5">Fresh produce,<br/>delivered before breakfast.</div>
     <div data-id="cta" style="margin-top:auto;background:var(--charte-color-accent);color:#fff;border-radius:10px;text-align:center;padding:4mm;font-weight:700">Get started</div>`,
	),
};

const onboardingRevised: Page = {
	...onboarding,
	html: screen(
		"Welcome",
		`<div data-id="hero" style="${box("height:44mm")};display:flex;align-items:center;justify-content:center;color:var(--charte-color-muted)">Illustration</div>
     <div data-id="dots" style="display:flex;justify-content:center;gap:1.5mm"><span style="width:5mm;height:1.5mm;border-radius:999px;background:var(--charte-color-accent)"></span><span style="width:1.5mm;height:1.5mm;border-radius:50%;background:var(--charte-color-line)"></span><span style="width:1.5mm;height:1.5mm;border-radius:50%;background:var(--charte-color-line)"></span></div>
     <div data-id="pitch" style="text-align:center;font-size:15px;font-weight:600;line-height:1.5">Fresh produce,<br/>delivered before breakfast.</div>
     <div data-id="social" style="display:flex;gap:2.5mm">
       <span style="${box("height:9mm")};flex:1;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600"> Apple</span>
       <span style="${box("height:9mm")};flex:1;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600">G Google</span>
     </div>
     <div data-id="cta" style="margin-top:auto;background:var(--charte-color-accent);color:#fff;border-radius:10px;text-align:center;padding:4mm;font-weight:700">Get started</div>`,
	),
};

const catalog: Page = {
	id: "s2",
	name: "Catalog",
	elements: [],
	html: screen(
		"Market",
		`<div data-id="search" style="${box("height:9mm")};display:flex;align-items:center;padding:0 4mm;color:var(--charte-color-muted);font-size:12px">Search…</div>
     ${chips}
     ${card("item1", "Heritage Tomatoes", "4,20 €")}
     ${card("item2", "Raw Honey", "7,80 €")}
     ${card("item3", "Sourdough Loaf", "5,00 €")}
     ${card("item4", "Goat Cheese", "3,50 €")}`,
	),
};

const checkout: Page = {
	id: "s3",
	name: "Checkout",
	elements: [],
	html: screen(
		"Your basket",
		`${basketRow("Heritage Tomatoes", "2", "8,40 €")}
     ${basketRow("Raw Honey", "1", "7,80 €")}
     ${basketRow("Sourdough Loaf", "1", "5,00 €")}
     <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--charte-color-muted);padding:1.5mm 0"><span>Delivery — tomorrow 7:00</span><span style="font-family:var(--charte-font-mono)">3,70 €</span></div>
     <div data-id="total" style="display:flex;justify-content:space-between;font-weight:800;font-size:16px;margin-top:1mm"><span>Total</span><span style="font-family:var(--charte-font-mono);color:var(--charte-color-accent)">24,90 €</span></div>
     <div data-id="pay" style="margin-top:auto;background:var(--charte-color-accent);color:#fff;border-radius:10px;text-align:center;padding:4mm;font-weight:700">Pay now</div>`,
	),
};

function wireDoc(pages: Page[]): Document {
	return {
		id: "app-wireframe",
		name: "app-wireframe",
		category: "wireframe",
		canvas: { w: 90, h: 195, background: "#fbfaf6", format: "custom" },
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
