#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Use the CI settings too: forbid focused tests and reusing an existing server.
for (const script of ["verify:quality", "test:e2e:coverage"]) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, CI: "1" },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
