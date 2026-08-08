#!/usr/bin/env tsx
/**
 * Local harness that simulates Claude Desktop's spawn of the .mcpb bundle.
 *
 * Steps:
 *   1. (optional) Rebuild bundles + deps into dist/.mcpb-test/
 *   2. Spawn `node dist/.mcpb-test/index.js` with MAKET_SERVER_ENTRY pointing
 *      at server.js, on a random MAKET_PORT and a temp MAKET_DATA_DIR.
 *   3. Pipe an MCP `initialize` NDJSON message on stdin.
 *   4. Read the first NDJSON reply on stdout, with a timeout.
 *   5. Print bridge.log, server-spawn.log, and stdout response. Kill child.
 *
 * Usage:
 *   npx tsx scripts/test-bundle.ts                 # reuse existing staging
 *   npx tsx scripts/test-bundle.ts --rebuild       # esbuild + npm install
 *   npx tsx scripts/test-bundle.ts --bridge-only   # rebuild bridge only
 */

import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STAGING = join(ROOT, "dist/.mcpb-test");

const EXTERNALS = [
  "@modelcontextprotocol/sdk",
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
  const spawnEnv: Record<string, string | undefined> = {
    ...process.env,
    MAKET_PORT: String(port),
    MAKET_DATA_DIR: dataDir,
    MAKET_SERVER_ENTRY: join(STAGING, "server.js"),
  };
  if (useElectron) spawnEnv.ELECTRON_RUN_AS_NODE = "1";
  console.log(`[harness] spawning with: ${spawnBin}`);

  const child = spawn(spawnBin, [join(STAGING, "index.js")], {
    cwd: STAGING,
    env: spawnEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout.on("data", (c) => {
    stdoutBuf += c.toString();
  });
  child.stderr.on("data", (c) => {
    stderrBuf += c.toString();
  });

  const initMsg = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "harness", version: "0" },
    },
  };
  child.stdin.write(`${JSON.stringify(initMsg)}\n`);

  const TIMEOUT_MS = 20_000;
  const deadline = Date.now() + TIMEOUT_MS;
  let response: string | null = null;
  while (Date.now() < deadline) {
    const nl = stdoutBuf.indexOf("\n");
    if (nl !== -1) {
      response = stdoutBuf.slice(0, nl).trim();
      if (response) break;
    }
    await new Promise((r) => setTimeout(r, 100));
    if (child.exitCode !== null) break;
  }

  child.stdin.end();
  child.kill("SIGTERM");

  console.log("\n=========== BRIDGE STDOUT ===========");
  console.log(response ? response : "(no response within 20s)");
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

  console.log(`\n[harness] child exitCode=${child.exitCode}`);

  rmSync(dataDir, { recursive: true, force: true });

  if (!response?.includes('"result"')) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
