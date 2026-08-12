#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = path.join(ROOT, "coverage/e2e/server");
const coverage = JSON.parse(await readFile(path.join(REPORT_DIR, "coverage-final.json"), "utf8"));
const map = libCoverage.createCoverageMap(coverage);
const covered = [];
const uncovered = [];
for (const file of map.files().sort()) {
  const relative = path.relative(ROOT, file).split(path.sep).join("/");
  const summary = map.fileCoverageFor(file).toSummary();
  const entry = { file: relative, lines: summary.lines.pct };
  if (summary.lines.covered > 0) covered.push(entry);
  else uncovered.push(entry);
}

const stdioFiles = (await walk(path.join(ROOT, "packages/stdio-bridge/src")))
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map(relativeToRoot);
const inventory = {
  inScope: covered.length + uncovered.length,
  covered,
  uncovered,
  outOfScope: ["packages/server/src/types.ts", "packages/server/src/core/tool-pack.ts", ...stdioFiles].sort(),
};
await writeFile(path.join(REPORT_DIR, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
process.stdout.write(
  `Server E2E coverage: ${covered.length}/${inventory.inScope} files execute at least one line; ${uncovered.length} files execute none.\n`,
);

function relativeToRoot(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}
