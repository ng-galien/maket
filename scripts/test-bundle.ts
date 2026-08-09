#!/usr/bin/env tsx
/**
 * Local harness that simulates Claude Desktop's spawn of the .mcpb bundle.
 *
 * Steps:
 *   1. (optional) Rebuild bundles + deps into dist/.mcpb-test/
 *   2. Spawn `node dist/.mcpb-test/index.js` with MAKET_SERVER_ENTRY pointing
 *      at server.js, on a random MAKET_PORT and a temp MAKET_DATA_DIR.
 *   3. Connect through the SDK v2 stdio client pinned to the modern revision.
 *   4. List tools through the packaged bridge.
 *   5. Print bridge.log, server-spawn.log, and the tool-list result.
 *
 * Usage:
 *   npx tsx scripts/test-bundle.ts                 # reuse existing staging
 *   npx tsx scripts/test-bundle.ts --rebuild       # esbuild + npm install
 *   npx tsx scripts/test-bundle.ts --bridge-only   # rebuild bridge only
 */

import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STAGING = join(ROOT, "dist/.mcpb-test");

const EXTERNALS = [
  "@modelcontextprotocol/node",
  "@modelcontextprotocol/server",
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

function sh(cmd: string, cwd = ROOT): void {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function buildBridge(): void {
  mkdirSync(STAGING, { recursive: true });
  sh(
    `npx esbuild packages/stdio-bridge/src/index.ts --bundle --platform=node --format=esm --outfile="${join(STAGING, "index.js")}"`,
  );
}

function buildServer(): void {
  const ext = EXTERNALS.map((e) => `--external:${e}`).join(" ");
  sh(
    `npx esbuild packages/server/index.ts --bundle --platform=node --format=esm --outfile="${join(STAGING, "server.js")}" ${ext}`,
  );
}

function installDeps(): void {
  const serverPkg = JSON.parse(readFileSync(join(ROOT, "packages/server/package.json"), "utf-8"));
  const { "@maket/shared": _shared, ...deps } = serverPkg.dependencies ?? {};
  writeFileSync(
    join(STAGING, "package.json"),
    JSON.stringify({ name: "maket-test", version: "0.0.0", type: "module", dependencies: deps }, null, 2),
  );
  sh("npm install --omit=dev --no-audit --no-fund", STAGING);
  cpSync(join(ROOT, "public"), join(STAGING, "public"), { recursive: true });
}

function pickFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const p = addr.port;
        srv.close(() => res(p));
      } else rej(new Error("no addr"));
    });
  });
}

async function main(): Promise<void> {
  const rebuild = process.argv.includes("--rebuild");
  const bridgeOnly = process.argv.includes("--bridge-only");

  if (rebuild || !existsSync(join(STAGING, "server.js"))) {
    rmSync(STAGING, { recursive: true, force: true });
    buildBridge();
    buildServer();
    installDeps();
  } else if (bridgeOnly) {
    buildBridge();
  } else {
    console.log("[harness] reusing existing staging (pass --rebuild to refresh)");
  }

  const port = await pickFreePort();
  const dataDir = mkdtempSync(join(tmpdir(), "maket-harness-"));
  console.log(`[harness] port=${port} dataDir=${dataDir}`);

  const useElectron = process.argv.includes("--electron");
  const electronBin = "/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper";
  const spawnBin = useElectron ? electronBin : process.execPath;
  const spawnEnv: Record<string, string> = {
    ...getDefaultEnvironment(),
    MAKET_PORT: String(port),
    MAKET_DATA_DIR: dataDir,
    MAKET_SERVER_ENTRY: join(STAGING, "server.js"),
  };
  if (useElectron) spawnEnv.ELECTRON_RUN_AS_NODE = "1";
  console.log(`[harness] spawning with: ${spawnBin}`);

  const transport = new StdioClientTransport({
    command: spawnBin,
    args: [join(STAGING, "index.js")],
    cwd: STAGING,
    env: spawnEnv,
    stderr: "pipe",
  });
  let stderrBuf = "";
  transport.stderr?.on("data", (c) => {
    stderrBuf += c.toString();
  });
  const client = new Client({ name: "bundle-harness", version: "1" }, { versionNegotiation: { mode: "auto" } });
  try {
    await client.connect(transport);
    const listed = await client.listTools();

    console.log("\n=========== MCP TOOLS ===========");
    console.log(
      JSON.stringify(
        listed.tools.map((tool) => tool.name),
        null,
        2,
      ),
    );
    console.log("\n=========== BRIDGE STDERR ===========");
    console.log(stderrBuf || "(empty)");

    for (const name of ["bridge.log", "server-spawn.log", "server.log"]) {
      const p = join(dataDir, name);
      console.log(`\n=========== ${name} ===========`);
      try {
        console.log(readFileSync(p, "utf-8"));
      } catch {
        console.log("(missing)");
      }
    }

    if (!listed.tools.some((tool) => tool.name === "maket_learn")) {
      process.exitCode = 1;
    }
  } finally {
    await client.close().catch(() => {});
    const stopped = spawnSync(spawnBin, [join(STAGING, "index.js"), "stop"], {
      cwd: STAGING,
      env: spawnEnv,
      stdio: "inherit",
    });
    rmSync(dataDir, { recursive: true, force: true });
    if (stopped.status !== 0) {
      console.error(`harness server cleanup failed (${stopped.status})`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
