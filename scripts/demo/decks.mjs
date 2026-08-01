/**
 * Deck spec for the demo recorder — one 7-page English deck.
 *
 * HTML bodies live in ./pages/*.html. Mermaid pages carry a `mermaid` block
 * that the driver injects *after* the HTML set, so the maket_html charte-check
 * never sees the rendered SVG colours.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, "pages", f), "utf-8");

const MERMAID_COLORS = {
  bg: "#FFFFFF",
  fg: "#0D1B2A",
  accent: "#00A8B5",
  line: "#94A3B8",
};

const AI_FLOW = `graph LR
  B["🗣️ Brief"] --> A["🤖 AI composer"]
  A --> C["📖 Charte"]
  A --> L["🖼️ Library"]
  C --> H["✨ HTML"]
  L --> H
  H --> P["👁️ Live preview"]
  P -.->|feedback| B
  classDef accent fill:#00A8B5,stroke:#00A8B5,color:#FFFFFF;
  classDef soft fill:#FFFFFF,stroke:#94A3B8,color:#0D1B2A;
  class B,P,A accent
  class C,L,H soft`;

export const decks = [
  {
    id: "en",
    name: "Maket deck EN",
    format: "A4",
    orientation: "landscape",
    category: "demo",
    charte: "maket-brand",
    pages: [
      { name: "The promise", html: read("en-01-promise.html") },
      { name: "Your brand", html: read("en-02-brand.html") },
      { name: "Your library", html: read("en-03-library.html") },
      {
        name: "The composer",
        html: read("en-04-ai.html"),
        mermaid: {
          targetId: "flow",
          dataId: "ai-flow",
          width: "150mm",
          height: "80mm",
          code: AI_FLOW,
          ...MERMAID_COLORS,
        },
      },
      { name: "Every kind of doc", html: read("en-05-docs.html") },
      { name: "Features at a glance", html: read("en-06-features.html") },
      { name: "Maket", html: read("en-07-brand.html") },
    ],
  },
];
