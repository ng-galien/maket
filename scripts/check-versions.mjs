#!/usr/bin/env node
/**
 * check-versions — fail if any workspace package.json or registry metadata
 * version drifts from the root. Wired into `npm run quality` so a release
 * bump that forgets a published surface can't land.
 *
 * Usage:
 *   node scripts/check-versions.mjs
 *
 * Exit codes:
 *   0 — all aligned
 *   1 — drift detected
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const packageLock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf-8"));
const expected = rootPkg.version;
const serverMetadata = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf-8"));

const workspaces = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({
    file: join(ROOT, "packages", d.name, "package.json"),
    lockKey: `packages/${d.name}`,
  }));

const drift = [];
for (const [name, version] of [
  ["npm lockfile", packageLock.version],
  ["npm lockfile root", packageLock.packages?.[""]?.version],
]) {
  if (version !== expected) {
    drift.push({
      file: join(ROOT, "package-lock.json"),
      version,
      name,
    });
  }
}
if (serverMetadata.version !== expected) {
  drift.push({
    file: join(ROOT, "server.json"),
    version: serverMetadata.version,
    name: "MCP Registry metadata",
  });
}
for (const [index, pkg] of (serverMetadata.packages ?? []).entries()) {
  if (pkg.version !== expected) {
    drift.push({
      file: join(ROOT, "server.json"),
      version: pkg.version,
      name: `MCP Registry package ${index + 1}`,
    });
  }
}
if (serverMetadata.name !== rootPkg.mcpName) {
  drift.push({
    file: join(ROOT, "server.json"),
    version: serverMetadata.name,
    name: `MCP Registry name (expected ${rootPkg.mcpName})`,
  });
}
for (const { file, lockKey } of workspaces) {
  const pkg = JSON.parse(readFileSync(file, "utf-8"));
  if (pkg.version !== expected) {
    drift.push({ file, version: pkg.version, name: pkg.name });
  }
  const lockVersion = packageLock.packages?.[lockKey]?.version;
  if (lockVersion !== expected) {
    drift.push({
      file: join(ROOT, "package-lock.json"),
      version: lockVersion,
      name: `${pkg.name} lockfile entry`,
    });
  }
}

if (drift.length === 0) {
  process.stdout.write(`check-versions: ok (packages, lockfile, and registry metadata at ${expected})\n`);
  process.exit(0);
}

process.stderr.write(`check-versions: drift — root is ${expected}, but:\n`);
for (const d of drift) {
  process.stderr.write(`  ${d.name}: ${d.version}  (${d.file})\n`);
}
process.stderr.write("\nFix: node scripts/bump-version.mjs <version>\n");
process.exit(1);
