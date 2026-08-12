#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_ROOT = path.join(ROOT, ".e2e-coverage");
const CLIENT_RAW = path.join(RAW_ROOT, "client-raw");
const SERVER_RAW = path.join(RAW_ROOT, "server-raw");
const REPORT_ROOT = path.join(ROOT, "coverage/e2e");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NODE = process.execPath;
const C8 = path.join(ROOT, "node_modules/c8/bin/c8.js");

await rm(RAW_ROOT, { recursive: true, force: true });
await rm(REPORT_ROOT, { recursive: true, force: true });
await mkdir(CLIENT_RAW, { recursive: true });
await mkdir(SERVER_RAW, { recursive: true });

const coverageEnv = {
  ...process.env,
  E2E_COVERAGE: "1",
  E2E_CLIENT_COVERAGE_DIR: CLIENT_RAW,
  NODE_V8_COVERAGE: SERVER_RAW,
};

await run(NPM, ["run", "build:client"], coverageEnv);
let testError;
try {
  await run(NPM, ["run", "test:e2e", "-w", "@maket/client", "--", ...process.argv.slice(2)], coverageEnv);
} catch (error) {
  testError = error;
}

let reportError;
try {
  await run(NODE, [path.join(ROOT, "scripts/e2e-client-coverage.mjs")], {
    ...process.env,
    E2E_CLIENT_COVERAGE_DIR: CLIENT_RAW,
  });
  await run(
    NODE,
    [
      C8,
      "report",
      "--temp-directory",
      SERVER_RAW,
      "--reports-dir",
      path.join(REPORT_ROOT, "server"),
      "--reporter",
      "html",
      "--reporter",
      "json",
      "--reporter",
      "json-summary",
      "--reporter",
      "lcovonly",
      "--reporter",
      "text-summary",
      "--all",
      "--include",
      "packages/server/src/**/*.ts",
      "--include",
      "packages/shared/src/**/*.ts",
      "--exclude",
      "**/*.test.ts",
      "--exclude",
      "**/types.ts",
      "--exclude",
      "**/core/tool-pack.ts",
      "--exclude-after-remap",
    ],
    process.env,
  );
  await run(NODE, [path.join(ROOT, "scripts/e2e-merge-shared-coverage.mjs")], {
    ...process.env,
    E2E_CLIENT_COVERAGE_DIR: CLIENT_RAW,
  });
  await run(NODE, [path.join(ROOT, "scripts/e2e-server-coverage-inventory.mjs")]);
  await run(NODE, [path.join(ROOT, "scripts/e2e-coverage-summary.mjs")]);
} catch (error) {
  reportError = error;
}

if (testError) throw testError;
if (reportError) throw reportError;

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code ?? "unknown"})`));
    });
  });
}
