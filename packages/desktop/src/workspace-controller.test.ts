import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isProcessAlive } from "@maket/runtime";
import { startMaketServer } from "@maket/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeOwnedError, WorkspaceController } from "./workspace-controller.js";

vi.mock("@maket/server", async () => {
  const actual = await vi.importActual<typeof import("@maket/server")>("@maket/server");
  return { ...actual, startMaketServer: vi.fn(actual.startMaketServer) };
});

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
    vi.mocked(startMaketServer).mockReset();
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
      describeProcess: () => "node /usr/local/lib/node_modules/@ng-galien/maket/server.js",
    });

    expect(controller.inspectOwner(workspace)).toMatchObject({
      owner: "legacy",
      pid: child.pid,
      port: 24842,
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

  it("clears a stale pid record instead of killing a recycled process", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "maket-desktop-stale-"));
    directories.push(workspace);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    children.push(child);
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });
    if (!child.pid) throw new Error("Test process did not receive a PID");
    writeFileSync(join(workspace, "server.pid"), `${child.pid}\n`, "utf8");

    const controller = new WorkspaceController({
      version: "test",
      packageDir: resolve(import.meta.dirname, "../../.."),
      describeProcess: () => "/Applications/SomeoneElse.app/Contents/MacOS/SomeoneElse",
    });
    const owner = controller.inspectOwner(workspace);
    if (!owner) throw new Error("Expected a legacy owner record");

    await controller.takeControl(owner);

    expect(isProcessAlive(child.pid)).toBe(true);
    expect(existsSync(join(workspace, "server.pid"))).toBe(false);
  });

  it("restores the previous workspace when the target fails to start", async () => {
    const previous = mkdtempSync(join(tmpdir(), "maket-desktop-previous-"));
    const target = mkdtempSync(join(tmpdir(), "maket-desktop-target-"));
    directories.push(previous, target);
    const firstClose = vi.fn(async () => undefined);
    const restoredClose = vi.fn(async () => undefined);
    vi.mocked(startMaketServer)
      .mockResolvedValueOnce({ url: "http://127.0.0.1:24843", close: firstClose } as never)
      .mockRejectedValueOnce(new Error("target startup failed"))
      .mockResolvedValueOnce({ url: "http://127.0.0.1:24843", close: restoredClose } as never);
    const controller = new WorkspaceController({
      version: "test",
      packageDir: resolve(import.meta.dirname, "../../.."),
    });
    await controller.start(previous);

    await expect(controller.switchTo(target)).rejects.toThrow("target startup failed");

    expect(firstClose).toHaveBeenCalledOnce();
    expect(controller.state().workspace).toBe(previous);
    await controller.stop();
    expect(restoredClose).toHaveBeenCalledOnce();
  });

  it("keeps ownership of the previous workspace when stopping it fails", async () => {
    const previous = mkdtempSync(join(tmpdir(), "maket-desktop-previous-"));
    const target = mkdtempSync(join(tmpdir(), "maket-desktop-target-"));
    directories.push(previous, target);
    const close = vi.fn().mockRejectedValueOnce(new Error("close failed")).mockResolvedValueOnce(undefined);
    vi.mocked(startMaketServer).mockResolvedValueOnce({
      url: "http://127.0.0.1:24843",
      close,
    } as never);
    const controller = new WorkspaceController({
      version: "test",
      packageDir: resolve(import.meta.dirname, "../../.."),
    });
    await controller.start(previous);

    await expect(controller.switchTo(target)).rejects.toThrow("close failed");

    expect(controller.state().workspace).toBe(previous);
    expect(startMaketServer).toHaveBeenCalledOnce();
    await controller.stop();
  });

  it("keeps ownership when a terminal disposer failure is reported repeatedly", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "maket-desktop-dispose-failure-"));
    directories.push(workspace);
    const close = vi.fn().mockRejectedValue(new Error("disposer failed"));
    vi.mocked(startMaketServer).mockResolvedValueOnce({
      url: "http://127.0.0.1:24843",
      closed: false,
      close,
    } as never);
    const controller = new WorkspaceController({
      version: "test",
      packageDir: resolve(import.meta.dirname, "../../.."),
    });
    await controller.start(workspace);

    await expect(controller.stop()).rejects.toThrow("disposer failed");
    await expect(controller.stop()).rejects.toThrow("disposer failed");

    expect(close).toHaveBeenCalledTimes(2);
    expect(controller.state().workspace).toBe(workspace);
  });

  it("releases ownership when close reports an error after completing cleanup", async () => {
    const previous = mkdtempSync(join(tmpdir(), "maket-desktop-previous-"));
    const target = mkdtempSync(join(tmpdir(), "maket-desktop-target-"));
    directories.push(previous, target);
    vi.mocked(startMaketServer)
      .mockResolvedValueOnce({
        url: "http://127.0.0.1:24843",
        closed: false,
        close: vi.fn(async function (this: { closed: boolean }) {
          this.closed = true;
          throw new Error("close reported cleanup errors");
        }),
      } as never)
      .mockResolvedValueOnce({
        url: "http://127.0.0.1:24843",
        closed: false,
        close: vi.fn(async () => undefined),
      } as never);
    const controller = new WorkspaceController({
      version: "test",
      packageDir: resolve(import.meta.dirname, "../../.."),
    });
    await controller.start(previous);

    await expect(controller.switchTo(target)).rejects.toThrow("close reported cleanup errors");

    expect(controller.state().workspace).toBe(previous);
    expect(startMaketServer).toHaveBeenCalledTimes(2);
  });

  it("closes a partially started server when descriptor publication fails", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "maket-desktop-descriptor-"));
    directories.push(workspace);
    mkdirSync(join(workspace, "runtime.json"));
    const close = vi.fn(async () => undefined);
    vi.mocked(startMaketServer).mockResolvedValueOnce({
      url: "http://127.0.0.1:24843",
      close,
    } as never);
    const controller = new WorkspaceController({
      version: "test",
      packageDir: resolve(import.meta.dirname, "../../.."),
    });

    await expect(controller.start(workspace)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    expect(readdirSync(workspace).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(() => controller.state()).toThrow("not started");
  });
});
