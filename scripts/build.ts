#!/usr/bin/env bun
// ============================================================
// BUILD — Compile Maket into standalone binaries
// ============================================================
//
// Usage:
//   bun run scripts/build.ts                    # current platform only
//   bun run scripts/build.ts --all              # all platforms
//   bun run scripts/build.ts --target darwin-arm64
//
// Output: dist/<platform>/maket[.exe]
// ============================================================

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");

interface Target {
  name: string;
  bunTarget: string;
  ext: string;
}

const TARGETS: Target[] = [
  { name: "macos-arm64", bunTarget: "bun-darwin-arm64", ext: "" },
  { name: "macos-x64", bunTarget: "bun-darwin-x64", ext: "" },
  { name: "linux-x64", bunTarget: "bun-linux-x64", ext: "" },
  { name: "linux-arm64", bunTarget: "bun-linux-arm64", ext: "" },
  { name: "windows-x64", bunTarget: "bun-windows-x64", ext: ".exe" },
];

function log(msg: string) {
  console.log(`[build] ${msg}`);
}

function buildClient() {
  log("Building client (React/Vite)...");
  execSync("cd client-react && npx vite build", {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function buildBinary(target: Target) {
  const outDir = join(DIST, target.name);
  mkdirSync(outDir, { recursive: true });

  const outFile = join(outDir, `maket${target.ext}`);

  log(`Compiling for ${target.name}...`);
  execSync(`bun build --compile --target=${target.bunTarget} --outfile="${outFile}" index.ts`, {
    cwd: ROOT,
    stdio: "inherit",
  });

  const assetsToBundle = ["public"];
  for (const dir of assetsToBundle) {
    const src = join(ROOT, dir);
    const dest = join(outDir, dir);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true });
      log(`  Copied ${dir}/`);
    }
  }

  log(`  → ${outFile}`);
}

// ---- Main ----

const args = process.argv.slice(2);
const buildAll = args.includes("--all");
const specificTarget = args.find((a) => a.startsWith("--target="))?.split("=")[1] || args[args.indexOf("--target") + 1];

// Step 1: Build client
buildClient();

// Step 2: Compile binaries
if (buildAll) {
  log(`Building all ${TARGETS.length} platforms...`);
  for (const t of TARGETS) buildBinary(t);
} else if (specificTarget) {
  const t = TARGETS.find((t) => t.name === specificTarget || t.bunTarget === specificTarget);
  if (!t) {
    console.error(`Unknown target: ${specificTarget}`);
    console.error(`Available: ${TARGETS.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }
  buildBinary(t);
} else {
  // Current platform
  const platform = process.platform === "darwin" ? "macos" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const name = `${platform}-${arch}`;
  const t = TARGETS.find((t) => t.name === name);
  if (!t) {
    console.error(`No target for current platform: ${name}`);
    process.exit(1);
  }
  buildBinary(t);
}

log("Done!");
