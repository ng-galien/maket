#!/usr/bin/env node
// ============================================================
// PACK-NPM — Stage Maket for `npm publish` under @ng-galien/maket
// ============================================================
//
// Usage:
//   node scripts/pack-npm.ts              # stage only, no publish
//   node scripts/pack-npm.ts --pack       # stage + produce installable tarball
//   node scripts/pack-npm.ts --publish    # stage + npm publish --access public
//   node scripts/pack-npm.ts --dry-run    # stage + npm publish --dry-run
//
// Output: dist/npm/ (ready-to-publish package directory).
//
// Installation contract for users:
//   npm install -g @ng-galien/maket   # global binary: `maket`
// ============================================================

import { execFileSync, execSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist", "npm");

function log(msg: string) {
  console.log(`[npm-pack] ${msg}`);
}

// Externals kept out of the server bundle — users install these from the
// staged package's own `dependencies` on first `npm install`.
const EXTERNALS = [
  "@modelcontextprotocol/sdk",
  "@resvg/resvg-js",
  "awilix",
  "beautiful-mermaid",
  "express",
  "jimp",
  "linkedom",
  "puppeteer",
  "ws",
  "zod",
];

function stage(): void {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const publicDir = join(ROOT, "public");
  if (existsSync(publicDir)) rmSync(publicDir, { recursive: true, force: true });

  log("Building client...");
  execSync("npm run build:client", { cwd: ROOT, stdio: "inherit" });

  log("Bundling stdio-bridge → index.js (bin entry)...");
  execSync(
    `npx esbuild packages/stdio-bridge/src/index.ts --bundle --platform=node --format=esm --outfile="${join(DIST, "index.js")}"`,
    { cwd: ROOT, stdio: "inherit" },
  );

  log("Bundling server → server.js...");
  const externalFlags = EXTERNALS.map((e) => `--external:${e}`).join(" ");
  execSync(
    `npx esbuild packages/server/index.ts --bundle --platform=node --format=esm --outfile="${join(DIST, "server.js")}" ${externalFlags}`,
    { cwd: ROOT, stdio: "inherit" },
  );

  const bridge = readFileSync(join(DIST, "index.js"), "utf-8");
  if (!bridge.startsWith("#!")) {
    writeFileSync(join(DIST, "index.js"), `#!/usr/bin/env node\n${bridge}`);
  }

  log("Copying runtime assets (public/, manifest.json, README, LICENSE)...");
  cpSync(join(ROOT, "public"), join(DIST, "public"), { recursive: true });
  cpSync(join(ROOT, "manifest.json"), join(DIST, "manifest.json"));
  cpSync(join(ROOT, "README.md"), join(DIST, "README.md"));
  cpSync(join(ROOT, "LICENSE"), join(DIST, "LICENSE"));

  log("Writing package.json...");
  const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const serverPkg = JSON.parse(readFileSync(join(ROOT, "packages/server/package.json"), "utf-8"));
  const { "@maket/shared": _shared, ...runtimeDeps } = serverPkg.dependencies ?? {};

  const npmPkg = {
    name: "@ng-galien/maket",
    version: rootPkg.version,
    mcpName: rootPkg.mcpName,
    description: rootPkg.description,
    keywords: ["mcp", "model-context-protocol", "ai", "design", "html", "pdf", "visual", "maket"],
    homepage: "https://ng-galien.github.io/maket/",
    repository: rootPkg.repository,
    bugs: rootPkg.bugs,
    license: rootPkg.license,
    author: rootPkg.author,
    type: "module",
    main: "server.js",
    bin: { maket: "index.js" },
    files: ["index.js", "server.js", "manifest.json", "public/**", "README.md", "LICENSE"],
    engines: { node: ">=22.0.0" },
    dependencies: runtimeDeps,
    publishConfig: { access: "public" },
  };
  writeFileSync(join(DIST, "package.json"), `${JSON.stringify(npmPkg, null, 2)}\n`);

  if (process.platform !== "win32") {
    chmodSync(join(DIST, "index.js"), 0o755);
  }

  const indexSize = (statSync(join(DIST, "index.js")).size / 1024).toFixed(1);
  const serverSize = (statSync(join(DIST, "server.js")).size / 1024).toFixed(1);
  log(`staged → ${DIST}`);
  log(`  index.js  ${indexSize} KB`);
  log(`  server.js ${serverSize} KB`);
}

function publish(dryRun: boolean): void {
  const flag = dryRun ? " --dry-run" : "";
  log(`npm publish${flag}...`);
  execSync(`npm publish${flag} --access public`, {
    cwd: DIST,
    stdio: "inherit",
  });
}

function pack(): string {
  log("Creating installable npm tarball...");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const output = execFileSync(npm, ["pack", "--json", "--pack-destination", join(ROOT, "dist")], {
    cwd: DIST,
    encoding: "utf-8",
  });
  const result = JSON.parse(output) as { filename?: string }[];
  const filename = result[0]?.filename;
  if (!filename) throw new Error(`npm pack did not return a filename: ${output}`);
  const tarball = join(ROOT, "dist", filename);
  log(`tarball → ${tarball}`);
  log(`install locally with: npm install -g --allow-scripts=puppeteer "${tarball}"`);
  return tarball;
}

// ---- Main ----
stage();

if (process.argv.includes("--pack")) {
  pack();
}

if (process.argv.includes("--publish")) {
  publish(false);
} else if (process.argv.includes("--dry-run")) {
  publish(true);
}

log("Done.");
