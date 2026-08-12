#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import v8ToIstanbul from "v8-to-istanbul";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SHARED_SRC = `${path.join(ROOT, "packages/shared/src")}${path.sep}`;
const RAW_DIR = path.resolve(process.env.E2E_CLIENT_COVERAGE_DIR ?? path.join(ROOT, ".e2e-coverage/client-raw"));
const REPORT_DIR = path.join(ROOT, "coverage/e2e/server");
const coverageMap = libCoverage.createCoverageMap(
  JSON.parse(await readFile(path.join(REPORT_DIR, "coverage-final.json"), "utf8")),
);

const rawFiles = (await readdir(RAW_DIR))
  .filter((file) => file.endsWith(".json"))
  .map((file) => path.join(RAW_DIR, file));
const sharedFiles = new Set();
for (const rawFile of rawFiles) {
  const raw = JSON.parse(await readFile(rawFile, "utf8"));
  for (const entry of raw.entries ?? []) {
    const scriptPath = browserScriptPath(entry.url);
    if (!scriptPath || !existsSync(scriptPath) || !entry.source) continue;
    const converter = v8ToIstanbul(scriptPath, 0, { source: entry.source });
    await converter.load();
    converter.applyCoverage(entry.functions);
    const converted = converter.toIstanbul();
    converter.destroy();
    for (const [file, coverage] of Object.entries(converted)) {
      if (!isSharedProductionFile(file)) continue;
      coverageMap.merge({ [file]: coverage });
      sharedFiles.add(file);
    }
  }
}

const context = libReport.createContext({ dir: REPORT_DIR, coverageMap });
for (const reporter of ["html", "json", "json-summary", "lcovonly", "text-summary"]) {
  reports.create(reporter).execute(context);
}
process.stdout.write(
  `Merged browser execution for ${sharedFiles.size} shared source file(s) into the server/shared report.\n`,
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

function isSharedProductionFile(file) {
  const resolved = path.resolve(file);
  return resolved.startsWith(SHARED_SRC) && !resolved.endsWith(".test.ts") && !resolved.endsWith(`${path.sep}types.ts`);
}
