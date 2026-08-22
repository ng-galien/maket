import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  isProcessAlive,
  readRuntimeDescriptor,
  removeRuntimeDescriptor,
  waitForProcessExit,
  writeRuntimeDescriptor,
} from "@maket/runtime";
import { createConfig, type MaketServer, startMaketServer } from "@maket/server";

export interface WorkspaceControllerOptions {
  version: string;
  packageDir: string;
  port?: number;
}

export interface RuntimeOwner {
  owner: "electron" | "headless" | "legacy";
  pid: number;
  host: string;
  port: number;
  dataDir: string;
}

export class RuntimeOwnedError extends Error {
  constructor(readonly descriptor: RuntimeOwner) {
    super(
      `Maket ${descriptor.owner} runtime already owns ${descriptor.dataDir} on ${descriptor.host}:${descriptor.port}`,
    );
  }
}

function readLegacyPid(dataDir: string): number | null {
  const path = join(dataDir, "server.pid");
  if (!existsSync(path)) return null;
  const pid = Number(readFileSync(path, "utf8").trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export class WorkspaceController {
  readonly home = join(homedir(), ".maket");
  private server: MaketServer | null = null;
  private instanceId: string | null = null;
  private workspace = this.home;

  constructor(private readonly options: WorkspaceControllerOptions) {}

  state() {
    if (!this.server) throw new Error("Maket runtime is not started");
    return {
      owner: "electron" as const,
      workspace: this.workspace,
      url: this.server.url,
      version: this.options.version,
    };
  }

  async start(workspace = this.home): Promise<void> {
    if (this.server) throw new Error("Maket runtime is already started");
    const dataDir = resolve(workspace);
    const existing = readRuntimeDescriptor(dataDir);
    if (existing && existing.pid !== process.pid) {
      if (isProcessAlive(existing.pid)) {
        throw new RuntimeOwnedError(existing);
      }
      removeRuntimeDescriptor(dataDir, existing.instanceId);
    }
    const legacyPid = readLegacyPid(dataDir);
    if (legacyPid && legacyPid !== process.pid) {
      if (isProcessAlive(legacyPid)) {
        throw new RuntimeOwnedError({
          owner: "legacy",
          pid: legacyPid,
          host: "127.0.0.1",
          port: this.options.port ?? 24842,
          dataDir,
        });
      }
      rmSync(join(dataDir, "server.pid"), { force: true });
    }
    const env = {
      ...process.env,
      MAKET_DATA_DIR: dataDir,
      MAKET_PORT: String(this.options.port ?? 24842),
      MAKET_BIND_HOST: "127.0.0.1",
    };
    const config = createConfig({
      env,
      packageDir: this.options.packageDir,
      packaged: true,
    });
    const server = await startMaketServer({
      config,
      loadEnvironment: false,
    });
    const instanceId = randomUUID();
    writeRuntimeDescriptor({
      schemaVersion: 1,
      owner: "electron",
      pid: process.pid,
      host: config.HOST,
      port: Number(new URL(server.url).port),
      dataDir,
      version: this.options.version,
      instanceId,
      startedAt: new Date().toISOString(),
    });
    this.workspace = dataDir;
    this.instanceId = instanceId;
    this.server = server;
  }

  async takeControl(owner: RuntimeOwner): Promise<void> {
    if (owner.owner === "electron") {
      throw new Error("Another Maket desktop instance owns this workspace");
    }
    if (!isProcessAlive(owner.pid)) return;

    if (owner.owner === "legacy") {
      const currentPid = readLegacyPid(owner.dataDir);
      if (currentPid !== owner.pid) {
        throw new Error("The running Maket server changed before takeover");
      }
    } else {
      const current = readRuntimeDescriptor(owner.dataDir);
      if (!current || current.pid !== owner.pid || current.owner !== "headless") {
        throw new Error("The running Maket server changed before takeover");
      }
    }

    process.kill(owner.pid, "SIGTERM");
    if (!(await waitForProcessExit(owner.pid))) {
      throw new Error(`Maket server ${owner.pid} did not stop within five seconds`);
    }

    if (owner.owner === "legacy") {
      if (readLegacyPid(owner.dataDir) === owner.pid) {
        rmSync(join(owner.dataDir, "server.pid"), { force: true });
      }
    } else {
      const current = readRuntimeDescriptor(owner.dataDir);
      if (current && current.pid === owner.pid) {
        removeRuntimeDescriptor(owner.dataDir, current.instanceId);
      }
    }
  }

  async switchTo(workspace: string): Promise<void> {
    const target = resolve(workspace);
    if (target === this.workspace) return;
    await this.stop();
    await this.start(target);
  }

  async stop(): Promise<void> {
    const server = this.server;
    const instanceId = this.instanceId;
    const workspace = this.workspace;
    this.server = null;
    this.instanceId = null;
    try {
      await server?.close();
    } finally {
      if (instanceId) removeRuntimeDescriptor(workspace, instanceId);
    }
  }
}
