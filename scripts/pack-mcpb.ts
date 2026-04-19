#!/usr/bin/env node
// ============================================================
// PACK-MCPB — Package Maket as a Node.js .mcpb bundle
// ============================================================
//
// Usage:
//   node scripts/pack-mcpb.ts              # production bundle
//   node scripts/pack-mcpb.ts --dev        # dev mode (licence bypass)
//
// Prerequisites:
//   - Install mcpb CLI: npm install -g @anthropic-ai/mcpb
//
// Output: dist/maket.mcpb
// ============================================================

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");

function log(msg: string) {
  console.log(`[pack] ${msg}`);
}

function checkMcpbCli(): void {
  try {
    execSync("mcpb --version", { stdio: "pipe" });
  } catch {
    console.error("[pack] ERROR: mcpb CLI not found.");
    console.error("[pack] Install it with: npm install -g @anthropic-ai/mcpb");
    process.exit(1);
  }
}

const EXTERNALS = [
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/sdk",
  "@resvg/resvg-js",
  "express",
  "ws",
  "puppeteer",
  "linkedom",
  "docx",
  "jimp",
];

function pack(dev: boolean): void {
  const stagingDir = join(DIST, ".mcpb-staging");
  const outputFile = join(DIST, dev ? "maket-dev.mcpb" : "maket.mcpb");

  try {
    // Clean previous staging
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });

    // Step 1: Build client (React/Vite → public/)
    log("Building client...");
    execSync("cd client-react && npx vite build", { cwd: ROOT, stdio: "inherit" });

    // Step 2: Bundle server code (TypeScript → single JS file for Node via esbuild)
    log("Bundling server...");
    const externalFlags = EXTERNALS.map((e) => `--external:${e}`).join(" ");
    execSync(
      `npx esbuild index.ts --bundle --platform=node --format=esm --outfile="${join(stagingDir, "index.js")}" ${externalFlags}`,
      { cwd: ROOT, stdio: "inherit" },
    );

    // Step 3: Install production dependencies in staging
    log("Installing production dependencies...");
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    const stagingPkg = {
      name: "maket",
      version: pkg.version,
      type: "module",
      dependencies: pkg.dependencies,
    };
    writeFileSync(join(stagingDir, "package.json"), JSON.stringify(stagingPkg, null, 2));
    execSync("npm install --omit=dev", { cwd: stagingDir, stdio: "inherit" });

    // Step 4: Copy runtime assets
    log("Copying assets...");
    cpSync(join(ROOT, "public"), join(stagingDir, "public"), { recursive: true });

    // Step 5: Generate manifest
    const baseManifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf-8"));
    baseManifest.version = pkg.version;

    if (dev) {
      delete baseManifest.user_config;
      baseManifest.name = "maket-dev";
      baseManifest.display_name = "Maket (DEV)";
    }

    writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(baseManifest, null, 2));

    // Step 6: Pack with mcpb
    if (existsSync(outputFile)) rmSync(outputFile);

    log("Packing .mcpb...");
    execSync(`mcpb pack "${stagingDir}" "${outputFile}"`, { cwd: ROOT, stdio: "inherit" });

    const size = (statSync(outputFile).size / (1024 * 1024)).toFixed(1);
    log(`→ ${outputFile} (${size} MB)`);
  } finally {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  }
}

// ---- Main ----
checkMcpbCli();

const dev = process.argv.includes("--dev");
if (dev) log("Dev mode: licence bypass enabled");

pack(dev);
log("Done!");
