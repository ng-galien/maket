import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "packages", "desktop", ".desktop");
mkdirSync(output, { recursive: true });

const serverExternals = [
  "@modelcontextprotocol/node",
  "@modelcontextprotocol/server",
  "@resvg/resvg-js",
  "awilix",
  "beautiful-mermaid",
  "electron",
  "express",
  "jimp",
  "linkedom",
  "puppeteer",
  "update-electron-app",
  "ws",
  "zod",
];

await Promise.all([
  build({
    entryPoints: [join(root, "packages", "desktop", "src", "main.ts")],
    outfile: join(output, "main.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: serverExternals,
    sourcemap: true,
  }),
  build({
    entryPoints: [join(root, "packages", "desktop", "src", "preload.ts")],
    outfile: join(output, "preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
]);
