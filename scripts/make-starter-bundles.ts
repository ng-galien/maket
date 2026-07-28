/**
 * Generates the starter `.maket` bundles in `starters/` from the demo
 * scenarios' final states — single source of truth: what the demo replays is
 * exactly what the starters ship. Inline data-URI images are converted to
 * real bundle assets on the way out.
 *
 *   npx tsx scripts/make-starter-bundles.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DemoScenario,
  FARM_LOGO_DATA_URI,
  finalWorkspace,
  productCatalogScenario,
} from "../packages/client/src/demo/scenario.js";
import { eventPosterScenario, POSTER_ART_DATA_URI } from "../packages/client/src/demo/scenario-poster.js";
import { appWireframeScenario } from "../packages/client/src/demo/scenario-wireframe.js";
import { type BundleAsset, encodeBundleV2 } from "../packages/server/src/lib/maket-format.js";
import type { Charte, Document } from "../packages/server/src/types.js";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "starters");

const DATA_URI_ASSETS: Record<string, string> = {
  [FARM_LOGO_DATA_URI]: "farm-logo.svg",
  [POSTER_ART_DATA_URI]: "poster-art.svg",
};

function svgBytes(dataUri: string): Buffer {
  return Buffer.from(decodeURIComponent(dataUri.slice("data:image/svg+xml,".length)), "utf-8");
}

/** Swap known data-URI images for `/assets/<file>` refs; report which. */
function extractAssets(doc: Document): { doc: Document; used: Set<string> } {
  const used = new Set<string>();
  const pages = doc.pages.map((page) => {
    let html = page.html ?? "";
    for (const [uri, file] of Object.entries(DATA_URI_ASSETS)) {
      if (html.includes(uri)) {
        html = html.replaceAll(uri, `/assets/${file}`);
        used.add(file);
      }
    }
    return { ...page, html: html || page.html };
  });
  return { doc: { ...doc, pages }, used };
}

async function writeStarter(scenario: DemoScenario): Promise<void> {
  const workspace = finalWorkspace(scenario);
  const used = new Set<string>();
  // Demo workspaces use the client-side Document shape; it is a structural
  // subset of the server's (missing fields default on import).
  const docs = (workspace.documents as unknown as Document[]).map((d) => {
    const { doc, used: docUsed } = extractAssets(d);
    for (const f of docUsed) used.add(f);
    return doc;
  });
  const assets: BundleAsset[] = [...used].map((file) => {
    const uri = Object.entries(DATA_URI_ASSETS).find(([, f]) => f === file);
    if (!uri) throw new Error(`Unknown asset file ${file}`);
    return { relPath: file, bytes: svgBytes(uri[0]) };
  });
  const buf = await encodeBundleV2(docs, workspace.chartes as unknown as Charte[], workspace.collections, assets);
  const out = join(OUT_DIR, scenario.downloadName);
  writeFileSync(out, buf);
  console.log(`Wrote ${out} (${buf.length} bytes)`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const scenario of [eventPosterScenario, appWireframeScenario, productCatalogScenario]) {
    await writeStarter(scenario);
  }
}

main();
