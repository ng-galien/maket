#!/usr/bin/env node
/**
 * Install the staged npm tarball into an isolated prefix and exercise the
 * actual distribution contract: dependency installation, headless Chromium,
 * server boot, tool discovery, and living-document Learn guidance.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const defaultTarball = join(ROOT, "dist", `ng-galien-maket-${rootPackage.version}.tgz`);
const tarball = process.argv[2] ? join(process.cwd(), process.argv[2]) : defaultTarball;
if (!existsSync(tarball)) throw new Error(`npm tarball not found: ${tarball}`);

const scratch = mkdtempSync(join(tmpdir(), "maket-npm-package-"));
const prefix = join(scratch, "install");
const dataDir = join(scratch, "data");
const puppeteerCacheDir = join(scratch, "puppeteer-cache");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const bin = process.platform === "win32" ? join(prefix, "maket.cmd") : join(prefix, "bin", "maket");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      [`${command} ${args.join(" ")} failed (${result.status})`, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not allocate a test port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function createRpcClient(child) {
  let buffer = "";
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
      }
      newline = buffer.indexOf("\n");
    }
  });
  return (message, timeoutMs = 30_000) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(message.id);
        reject(new Error(`timed out waiting for JSON-RPC id ${message.id}`));
      }, timeoutMs);
      pending.set(message.id, (response) => {
        clearTimeout(timeout);
        pending.delete(message.id);
        resolve(response);
      });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
}

let bridge;
let port;
try {
  process.stdout.write(`[npm-package-test] installing ${tarball}\n`);
  const installed = run(
    npm,
    [
      "install",
      "-g",
      "--prefix",
      prefix,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--allow-scripts=puppeteer",
      tarball,
    ],
    {
      env: { ...process.env, PUPPETEER_CACHE_DIR: puppeteerCacheDir },
    },
  );
  process.stdout.write(installed.stdout);
  process.stderr.write(installed.stderr);
  const installOutput = `${installed.stdout}\n${installed.stderr}`;
  if (/npm warn (?:deprecated|allow-scripts)/i.test(installOutput)) {
    throw new Error(`npm install emitted a blocked warning:\n${installOutput}`);
  }

  const installedPackage = join(
    prefix,
    ...(process.platform === "win32" ? [] : ["lib"]),
    "node_modules",
    "@ng-galien",
    "maket",
  );
  if (lstatSync(installedPackage).isSymbolicLink()) {
    throw new Error("installed package is a symlink, expected an autonomous copy");
  }

  port = await pickFreePort();
  const env = {
    ...process.env,
    MAKET_PORT: String(port),
    MAKET_DATA_DIR: dataDir,
    PUPPETEER_CACHE_DIR: puppeteerCacheDir,
  };
  const doctor = run(bin, ["doctor"], { env });
  if (!doctor.stdout.includes("Chromium headless — HeadlessChrome/")) {
    throw new Error(`doctor did not launch headless Chromium:\n${doctor.stdout}`);
  }

  const installPreview = run(bin, ["install", "codex"], { env });
  const expectedEntry = realpathSync(join(installedPackage, "index.js"));
  const commandLine = installPreview.stdout.match(/^command = (.+)$/m)?.[1];
  const configuredCommand = commandLine ? JSON.parse(commandLine) : "";
  if (!isAbsolute(configuredCommand) || !installPreview.stdout.includes(JSON.stringify(expectedEntry))) {
    throw new Error(`Codex install preview is not absolute:\n${installPreview.stdout}`);
  }

  bridge = spawn(bin, ["bridge"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  bridge.stderr.resume();
  const rpc = createRpcClient(bridge);
  const initialized = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "npm-package-test", version: "1" },
    },
  });
  if (initialized.error) throw new Error(JSON.stringify(initialized.error));

  const listed = await rpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  const names = new Set(listed.result?.tools?.map((tool) => tool.name) ?? []);
  for (const name of ["maket_state", "maket_learn"]) {
    if (!names.has(name)) throw new Error(`installed server does not expose ${name}`);
  }

  const learned = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "maket_learn",
      arguments: { action: "topic", topic: "state", audience: "agent" },
    },
  });
  const learnText = learned.result?.content?.map((item) => item.text ?? "").join("\n") ?? "";
  if (!learnText.includes("maket_state action=init")) {
    throw new Error(`installed Learn does not contain state guidance: ${learnText}`);
  }

  process.stdout.write(
    `[npm-package-test] ok — ${names.size} tools, headless Chromium, absolute client config, Learn state\n`,
  );
} finally {
  bridge?.kill("SIGTERM");
  if (existsSync(bin) && port) {
    spawnSync(bin, ["stop"], {
      env: {
        ...process.env,
        MAKET_PORT: String(port),
        MAKET_DATA_DIR: dataDir,
        PUPPETEER_CACHE_DIR: puppeteerCacheDir,
      },
      stdio: "ignore",
    });
  }
  rmSync(scratch, { recursive: true, force: true });
}
