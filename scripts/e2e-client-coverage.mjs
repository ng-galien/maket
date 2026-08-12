#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import v8ToIstanbul from "v8-to-istanbul";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SRC = path.join(ROOT, "packages/client/src");
const PUBLIC_DIR = path.join(ROOT, "public");
const RAW_DIR = path.resolve(process.env.E2E_CLIENT_COVERAGE_DIR ?? path.join(ROOT, ".e2e-coverage/client-raw"));
const REPORT_DIR = path.join(ROOT, "coverage/e2e/client");

const sourceFiles = (await walk(CLIENT_SRC)).filter((file) => /\.(ts|tsx|json)$/.test(file));
const productionFiles = sourceFiles.filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
const outOfScope = productionFiles.filter(isOutOfScope);
const inScope = productionFiles.filter((file) => /\.(ts|tsx)$/.test(file) && !isOutOfScope(file));
const inScopeSet = new Set(inScope.map((file) => path.resolve(file)));

const rawFiles = existsSync(RAW_DIR)
  ? (await readdir(RAW_DIR)).filter((file) => file.endsWith(".json")).map((file) => path.join(RAW_DIR, file))
  : [];
if (rawFiles.length === 0) {
  throw new Error(`No Playwright client coverage found in ${RAW_DIR}`);
}

const coverageMap = libCoverage.createCoverageMap({});
let convertedEntries = 0;
for (const rawFile of rawFiles) {
  const raw = JSON.parse(await readFile(rawFile, "utf8"));
  for (const entry of raw.entries ?? []) {
    const scriptPath = browserScriptPath(entry.url);
    if (!scriptPath || !existsSync(scriptPath) || !entry.source) continue;
    const converter = v8ToIstanbul(scriptPath, 0, { source: entry.source });
    await converter.load();
    converter.applyCoverage(entry.functions);
    coverageMap.merge(converter.toIstanbul());
    converter.destroy();
    convertedEntries += 1;
  }
}
if (convertedEntries === 0) {
  throw new Error("Playwright coverage contained no convertible client scripts");
}

coverageMap.filter((file) => inScopeSet.has(path.resolve(file)));
for (const file of inScope) {
  if (coverageMap.data[file]) continue;
  const source = await readFile(file, "utf8");
  const converter = v8ToIstanbul(file, 0, { source });
  await converter.load();
  converter.applyCoverage([
    {
      functionName: "(empty-report)",
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: source.length, count: 0 }],
    },
  ]);
  coverageMap.merge(converter.toIstanbul());
  converter.destroy();
}

await rm(REPORT_DIR, { recursive: true, force: true });
await mkdir(REPORT_DIR, { recursive: true });
const context = libReport.createContext({ dir: REPORT_DIR, coverageMap });
for (const reporter of ["html", "json", "json-summary", "lcovonly", "text-summary"]) {
  reports.create(reporter).execute(context);
}

const inventory = buildInventory(coverageMap, inScope, outOfScope);
await writeFile(path.join(REPORT_DIR, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
process.stdout.write(
  `Client E2E coverage: ${inventory.covered.length}/${inventory.inScope} files execute at least one line; ${inventory.uncovered.length} files execute none.\n`,
);

function browserScriptPath(url) {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
    if (!pathname.startsWith("assets/")) return null;
    return path.join(PUBLIC_DIR, pathname);
  } catch {
    return null;
  }
}

function buildInventory(map, scope, excluded) {
  const covered = [];
  const uncovered = [];
  for (const file of scope) {
    const relative = relativeToRoot(file);
    const fileCoverage = map.data[file];
    if (!fileCoverage) {
      uncovered.push({ file: relative, lines: 0 });
      continue;
    }
    const summary = libCoverage.createFileCoverage(fileCoverage).toSummary();
    const entry = { file: relative, lines: summary.lines.pct };
    if (summary.lines.covered > 0) covered.push(entry);
    else uncovered.push(entry);
  }
  covered.sort((a, b) => a.file.localeCompare(b.file));
  uncovered.sort((a, b) => a.file.localeCompare(b.file));
  return {
    inScope: scope.length,
    covered,
    uncovered,
    outOfScope: excluded.map(relativeToRoot).sort(),
  };
}

function isOutOfScope(file) {
  const relative = path.relative(CLIENT_SRC, file).split(path.sep).join("/");
  return (
    relative.endsWith(".json") ||
    relative === "test-setup.ts" ||
    relative === "store/types.ts" ||
    relative === "components/docs/types.ts"
  );
}

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
