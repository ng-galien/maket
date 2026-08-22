import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isProcessAlive } from "@maket/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeOwnedError, WorkspaceController } from "./workspace-controller.js";

describe("WorkspaceController legacy takeover", () => {
  const directories: string[] = [];
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children) {
      if (child.pid && isProcessAlive(child.pid)) child.kill("SIGTERM");
    }
    for (const directory of directories) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires an explicit takeover before stopping a legacy server", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "maket-desktop-"));
    directories.push(workspace);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    children.push(child);
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });
    if (!child.pid) throw new Error("Test server did not receive a PID");
    writeFileSync(join(workspace, "server.pid"), `${child.pid}\n`, "utf8");

    const controller = new WorkspaceController({
      version: "test",
      packageDir: resolve(import.meta.dirname, "../../.."),
    });

    let conflict: RuntimeOwnedError | null = null;
    try {
      await controller.start(workspace);
    } catch (error) {
      if (error instanceof RuntimeOwnedError) conflict = error;
      else throw error;
    }

    expect(conflict?.descriptor).toMatchObject({
      owner: "legacy",
      pid: child.pid,
      dataDir: workspace,
    });
    expect(isProcessAlive(child.pid)).toBe(true);

    if (!conflict) throw new Error("Expected a legacy runtime conflict");
    await controller.takeControl(conflict.descriptor);

    expect(isProcessAlive(child.pid)).toBe(false);
    expect(existsSync(join(workspace, "server.pid"))).toBe(false);
  });
});
