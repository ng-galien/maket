#!/usr/bin/env node
/**
 * Cross-platform launcher for `npm run dev` and friends.
 *
 * Replaces a handful of POSIX-only one-liners (env-var prefix + `&` + `wait`)
 * that broke on Windows. Each mode below maps to one entry in package.json:
 *
 *   dev           — server (--watch) + client Vite HMR, both forwarded
 *   dev:watch     — server (--watch) + client `vite build --watch` to public/
 *   dev:server    — server (--watch) only
 *   start:isolated — server on :3333 with $PWD/.maket
 *   e2e:server    — wipe ./.e2e-maket then start a fresh server on :3399
 *
 * Forwards stdout/stderr from each child, exits non-zero if any child does,
 * and broadcasts SIGINT/SIGTERM so Ctrl-C cleans up everything.
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const MODE = process.argv[2];
const ROOT = resolve(process.cwd());
const NPM_CMD = process.platform === "win32" ? "npm.cmd" : "npm";
const NPX_CMD = process.platform === "win32" ? "npx.cmd" : "npx";

/** Spawn a child with the given env merged onto process.env. */
function run(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: false,
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(0);
    }
    if (code !== 0) {
      process.stderr.write(`[dev] ${name} exited with code ${code}\n`);
      process.exit(code ?? 1);
    }
  });
  return child;
}

function spawnAll(children) {
  const stop = (signal) => {
    for (const c of children) {
      if (!c.killed) c.kill(signal);
    }
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

const PORT = process.env.MAKET_PORT ?? "24844";
const DATA_DIR = resolve(ROOT, ".maket");

const SERVER_ENV = { MAKET_PORT: PORT, MAKET_DATA_DIR: DATA_DIR };
const SERVER_ARGS = ["tsx", "--watch", "packages/server/index.ts"];

switch (MODE) {
  case "dev": {
    const server = run("server", NPX_CMD, SERVER_ARGS, SERVER_ENV);
    const client = run("client", NPM_CMD, ["run", "dev", "-w", "@maket/client"], { MAKET_PORT: PORT });
    spawnAll([server, client]);
    break;
  }
  case "dev:watch": {
    const server = run("server", NPX_CMD, SERVER_ARGS, SERVER_ENV);
    const client = run("client-build", NPM_CMD, ["run", "build", "-w", "@maket/client", "--", "--watch"], {
      MAKET_PORT: PORT,
    });
    spawnAll([server, client]);
    break;
  }
  case "dev:server": {
    const server = run("server", NPX_CMD, SERVER_ARGS, SERVER_ENV);
    spawnAll([server]);
    break;
  }
  case "start:isolated": {
    const server = run("server", NPX_CMD, ["tsx", "packages/server/index.ts"], {
      MAKET_PORT: "3333",
      MAKET_DATA_DIR: DATA_DIR,
    });
    spawnAll([server]);
    break;
  }
  case "e2e:server": {
    const e2eDir = resolve(ROOT, ".e2e-maket");
    rmSync(e2eDir, { recursive: true, force: true });
    const server = run("server", NPX_CMD, ["tsx", "packages/server/index.ts"], {
      MAKET_PORT: "3399",
      MAKET_DATA_DIR: e2eDir,
    });
    spawnAll([server]);
    break;
  }
  default:
    process.stderr.write(`Usage: node scripts/dev.mjs <dev|dev:watch|dev:server|start:isolated|e2e:server>\n`);
    process.exit(2);
}
