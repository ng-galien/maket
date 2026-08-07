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
import { POSTER_WAVES } from "../packages/client/src/demo/illustrations.js";
import {
  type DemoScenario,
  FARM_LOGO_DATA_URI,
  finalWorkspace,
  productCatalogScenario,
} from "../packages/client/src/demo/scenario.js";
import { bistroMenuScenario } from "../packages/client/src/demo/scenario-menu.js";
import { eventPosterScenario } from "../packages/client/src/demo/scenario-poster.js";
import { socialSeriesScenario } from "../packages/client/src/demo/scenario-social.js";
import { livingChecklistScenario } from "../packages/client/src/demo/scenario-state.js";
import { appWireframeScenario } from "../packages/client/src/demo/scenario-wireframe.js";
import { type BundleAsset, encodeBundleV2 } from "../packages/server/src/lib/maket-format.js";
import type { Charte, Document } from "../packages/server/src/types.js";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "starters");
const STARTER_EXPORTED_AT = "2000-01-01T00:00:00.000Z";
const STARTER_ENTRY_DATE = new Date(STARTER_EXPORTED_AT);

const DATA_URI_ASSETS: Record<string, string> = {
  [FARM_LOGO_DATA_URI]: "farm-logo.svg",
  [POSTER_WAVES]: "poster-art.svg",
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
  const docs = (workspace.documents as unknown as Document[]).map((d) => {
    const { doc, used: docUsed } = extractAssets(d);
    for (const f of docUsed) used.add(f);
    return doc;
  });
  const assets: BundleAsset[] = Object.entries(DATA_URI_ASSETS)
    .filter(([, file]) => used.has(file))
    .map(([uri, file]) => ({ relPath: file, bytes: svgBytes(uri) }));
  const documentStates = Object.entries(workspace.documentStates ?? {}).map(([docName, state]) => {
    const doc = docs.find((item) => item.name === docName);
    if (!doc) throw new Error(`State-backed starter document "${docName}" is missing.`);
    return { documentId: doc.id, schema: state.schema, data: state.data };
  });
  const buf = await encodeBundleV2(docs, workspace.chartes as unknown as Charte[], workspace.collections, assets, {
    exportedAt: STARTER_EXPORTED_AT,
    entryDate: STARTER_ENTRY_DATE,
    documentStates,
  });
  const out = join(OUT_DIR, scenario.downloadName);
  writeFileSync(out, buf);
  console.log(`Wrote ${out} (${buf.length} bytes)`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const scenario of [
    eventPosterScenario,
    appWireframeScenario,
    productCatalogScenario,
    bistroMenuScenario,
    socialSeriesScenario,
    livingChecklistScenario,
  ]) {
    await writeStarter(scenario);
  }
}

main();
