/**
 * Generates the starter `.maket` bundles in `starters/` — small, polished,
 * self-contained workspaces (document + charte + assets, and a collection for
 * the catalog) that solve the blank-page problem and feed the demo pages.
 *
 *   npx tsx scripts/make-starter-bundles.ts
 *
 * Uses the server's own encoder so the bundles always match the real format.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Collection } from "@maket/shared";
import { type BundleAsset, encodeBundleV2 } from "../packages/server/src/lib/maket-format.js";
import { createDocument } from "../packages/server/src/types.js";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "starters");

const svg = (body: string) => Buffer.from(body, "utf-8");

// ── 1. Event poster ──────────────────────────────────────────────────────────

const posterArt = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f2a33c"/><stop offset="1" stop-color="#c85a19"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="none"/>
  <circle cx="320" cy="80" r="60" fill="url(#g)" opacity="0.9"/>
  <path d="M0 220 Q100 160 200 210 T400 200 V300 H0 Z" fill="url(#g)" opacity="0.55"/>
  <path d="M0 250 Q120 200 240 245 T400 240 V300 H0 Z" fill="url(#g)" opacity="0.8"/>
</svg>`);

const posterCharte = {
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

const eventPoster = createDocument({
  name: "event-poster",
  category: "poster",
  canvas: { w: 210, h: 297, background: "#101423", format: "A4" },
  meta: { charte: "midnight-brass" },
  pages: [
    {
      id: "p1",
      name: "Poster",
      elements: [],
      html: `<div style="position:relative;width:100%;height:100%;overflow:hidden;font-family:var(--charte-font-body);color:var(--charte-color-text)">
  <img data-id="art" data-name="artwork" src="/assets/poster-art.svg" alt="" style="position:absolute;inset:auto 0 0 0;width:100%;opacity:0.9"/>
  <div style="position:relative;padding:18mm 16mm 0">
    <div data-id="kicker" data-name="kicker" style="letter-spacing:0.35em;font-size:13px;color:var(--charte-color-primary);text-transform:uppercase">Les Docks &middot; Season 12</div>
    <h1 data-id="title" data-name="title" style="font-family:var(--charte-font-heading);font-size:76px;line-height:0.95;margin:8mm 0 0">MIDNIGHT<br/>BRASS<br/>FESTIVAL</h1>
    <div data-id="date" data-name="date" style="margin-top:10mm;font-size:22px;font-weight:600;color:var(--charte-color-primary)">Fri 13 &ndash; Sun 15 March &middot; 8pm</div>
    <div data-id="lineup" data-name="lineup" style="margin-top:8mm;font-size:15px;line-height:1.9;color:var(--charte-color-muted)">
      The Copper Section &middot; Nora Vane Quartet<br/>
      Balkan Tide &middot; Saint-Louis Brass Band<br/>
      Late set: DJ Mille-Feuille
    </div>
  </div>
  <div data-id="footer" data-name="footer" style="position:absolute;left:16mm;right:16mm;bottom:10mm;display:flex;justify-content:space-between;font-size:12px;color:var(--charte-color-muted)">
    <span>Quai des Docks 12, Nantes</span><span>midnightbrass.example</span>
  </div>
</div>`,
    },
  ],
});

// ── 2. App wireframe ─────────────────────────────────────────────────────────

const wireCharte = {
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

const box = (extra = "") => `border:1.5px dashed var(--charte-color-line);border-radius:8px;${extra}`;

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

const appWireframe = createDocument({
  name: "app-wireframe",
  category: "wireframe",
  canvas: { w: 90, h: 195, background: "#fbfbfd", format: "custom" },
  meta: { charte: "wireframe-ink" },
  pages: [
    {
      id: "s1",
      name: "Onboarding",
      elements: [],
      html: screen(
        "Welcome",
        `<div data-id="hero" style="${box("height:52mm")};display:flex;align-items:center;justify-content:center;color:var(--charte-color-line)">Illustration</div>
         <div data-id="pitch" style="text-align:center;font-size:14px;line-height:1.5">Fresh produce,<br/>delivered before breakfast.</div>
         <div data-id="cta" style="margin-top:auto;background:var(--charte-color-primary);color:#fff;border-radius:10px;text-align:center;padding:4mm;font-weight:600">Get started</div>`,
      ),
    },
    {
      id: "s2",
      name: "Catalog",
      elements: [],
      html: screen(
        "Market",
        `<div data-id="search" style="${box("height:10mm")};display:flex;align-items:center;padding:0 4mm;color:var(--charte-color-line)">Search&hellip;</div>
         ${card("item1", "18mm")}${card("item2", "18mm")}${card("item3", "18mm")}${card("item4", "18mm")}`,
      ),
    },
    {
      id: "s3",
      name: "Checkout",
      elements: [],
      html: screen(
        "Your basket",
        `${card("line1", "16mm")}${card("line2", "16mm")}
         <div data-id="total" style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-top:2mm"><span>Total</span><span>24,90 &euro;</span></div>
         <div data-id="pay" style="margin-top:auto;background:var(--charte-color-primary);color:#fff;border-radius:10px;text-align:center;padding:4mm;font-weight:600">Pay now</div>`,
      ),
    },
  ],
});

// ── 3. Product catalog (collection-driven labels) ────────────────────────────

const farmLogo = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="30" fill="#2f6b4f"/>
  <path d="M32 14 C40 24 44 32 32 50 C20 32 24 24 32 14 Z" fill="#eaf3e2"/>
</svg>`);

const farmCharte = {
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

const productsCollection = {
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
    { id: "m1", position: 1, data: { name: "Heritage Tomatoes", price: "4,20 €", unit: "kg", origin: "Loire Valley" } },
    { id: "m2", position: 2, data: { name: "Raw Honey", price: "7,80 €", unit: "500 g", origin: "Cévennes" } },
    { id: "m3", position: 3, data: { name: "Goat Cheese", price: "3,50 €", unit: "piece", origin: "Poitou" } },
    { id: "m4", position: 4, data: { name: "Sourdough Loaf", price: "5,00 €", unit: "800 g", origin: "Baked here" } },
    { id: "m5", position: 5, data: { name: "Cider Brut", price: "6,40 €", unit: "75 cl", origin: "Normandy" } },
    { id: "m6", position: 6, data: { name: "Walnut Oil", price: "11,90 €", unit: "25 cl", origin: "Périgord" } },
  ],
};

const productCatalog = createDocument({
  name: "price-labels",
  category: "label",
  canvas: { w: 90, h: 54, background: "#f6f3ea", format: "custom" },
  meta: { charte: "greenmarket" },
  pages: [
    {
      id: "l1",
      name: "Label",
      elements: [],
      collection: { name: "products" },
      html: `<div style="width:100%;height:100%;font-family:var(--charte-font-body);color:var(--charte-color-text);display:flex;align-items:center;gap:5mm;padding:5mm;border:2px solid var(--charte-color-primary);border-radius:4px">
  <img data-id="logo" data-name="logo" src="/assets/farm-logo.svg" alt="" style="width:13mm;height:13mm;flex-shrink:0"/>
  <div style="flex:1;min-width:0">
    <div data-id="name" data-name="name" style="font-size:19px;font-weight:700;color:var(--charte-color-primary)">{{ name }}</div>
    <div data-id="origin" data-name="origin" style="font-size:12px;font-style:italic;margin-top:1mm">{{ origin }}</div>
  </div>
  <div style="text-align:right;flex-shrink:0">
    <div data-id="price" data-name="price" style="font-size:24px;font-weight:700;color:var(--charte-color-accent)">{{ price }}</div>
    <div data-id="unit" data-name="unit" style="font-size:11px;color:var(--charte-color-primary)">per {{ unit }}</div>
  </div>
</div>`,
    },
  ],
});

// ── Encode ───────────────────────────────────────────────────────────────────

const starters: Array<{
  file: string;
  docs: Parameters<typeof encodeBundleV2>[0];
  chartes: Parameters<typeof encodeBundleV2>[1];
  collections: Collection[];
  assets: BundleAsset[];
}> = [
  {
    file: "event-poster.maket",
    docs: [eventPoster],
    chartes: [posterCharte],
    collections: [],
    assets: [{ relPath: "poster-art.svg", bytes: posterArt }],
  },
  {
    file: "app-wireframe.maket",
    docs: [appWireframe],
    chartes: [wireCharte],
    collections: [],
    assets: [],
  },
  {
    file: "product-catalog.maket",
    docs: [productCatalog],
    chartes: [farmCharte],
    collections: [productsCollection],
    assets: [{ relPath: "farm-logo.svg", bytes: farmLogo }],
  },
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const s of starters) {
    const buf = await encodeBundleV2(s.docs, s.chartes, s.collections, s.assets);
    const out = join(OUT_DIR, s.file);
    writeFileSync(out, buf);
    console.log(`Wrote ${out} (${buf.length} bytes)`);
  }
}

main();
