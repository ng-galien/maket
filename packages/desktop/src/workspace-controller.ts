import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  isProcessAlive,
  RUNTIME_DESCRIPTOR_FILE,
  readRuntimeDescriptor,
  removeRuntimeDescriptor,
  waitForProcessExit,
  writeRuntimeDescriptor,
} from "@maket/runtime";
import { type BrowserPool, createConfig, type MaketServer, startMaketServer } from "@maket/server";
import type { Settings } from "@maket/shared";

export const DESKTOP_SERVER_PORT = 24843;
const HEADLESS_SERVER_PORT = 24842;

export interface WorkspaceControllerOptions {
  version: string;
  packageDir: string;
  port?: number;
  browserPool?: BrowserPool;
  /** Notified after every settings change, so the host can follow the language
   *  without watching the settings file. */
  onSettingsChanged?: (settings: Settings) => void;
  /** Command line of a running process; tests substitute their own. */
  describeProcess?: (pid: number) => string | null;
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

/** Command line of a live process, or null when it cannot be read. */
function readProcessCommand(pid: number): string | null {
  if (process.platform === "win32") return null;
  try {
    return execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** PIDs are recycled: a stale ownership record can name an unrelated process.
 * An unreadable command line stays trusted so takeover still works on Windows. */
export function looksLikeMaketServer(command: string | null): boolean {
  return command === null || command === "" || /maket/i.test(command);
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

  inspectOwner(workspace = this.home): RuntimeOwner | null {
    const dataDir = resolve(workspace);
    const descriptor = readRuntimeDescriptor(dataDir);
    if (descriptor && descriptor.pid !== process.pid && isProcessAlive(descriptor.pid)) {
      return descriptor;
    }
    const legacyPid = readLegacyPid(dataDir);
    if (legacyPid && legacyPid !== process.pid && isProcessAlive(legacyPid)) {
      return {
        owner: "legacy",
        pid: legacyPid,
        host: "127.0.0.1",
        port: HEADLESS_SERVER_PORT,
        dataDir,
      };
    }
    return null;
  }

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
          port: HEADLESS_SERVER_PORT,
          dataDir,
        });
      }
      rmSync(join(dataDir, "server.pid"), { force: true });
    }
    const env = {
      ...process.env,
      MAKET_DATA_DIR: dataDir,
      MAKET_PORT: String(this.options.port ?? DESKTOP_SERVER_PORT),
      MAKET_BIND_HOST: "127.0.0.1",
    };
    const config = createConfig({
      env,
      packageDir: this.options.packageDir,
      packaged: true,
    });
    const server = await startMaketServer({
      config,
      bootstrap: { browserPool: this.options.browserPool },
      loadEnvironment: false,
      onSettingsChanged: this.options.onSettingsChanged,
    });
    const instanceId = randomUUID();
    this.workspace = dataDir;
    this.instanceId = instanceId;
    this.server = server;
    try {
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
    } catch (error) {
      let closeError: unknown;
      let closeSucceeded = false;
      try {
        await server.close();
        closeSucceeded = true;
      } catch (caught) {
        closeError = caught;
      }
      if (closeSucceeded || server.closed) {
        this.server = null;
        this.instanceId = null;
      }
      rmSync(join(dataDir, `${RUNTIME_DESCRIPTOR_FILE}.${instanceId}.tmp`), { force: true });
      if (closeError) {
        throw new AggregateError([error, closeError], "Failed to publish runtime ownership and close the server");
      }
      throw error;
    }
  }

  async takeControl(owner: RuntimeOwner): Promise<void> {
    if (owner.owner === "electron") {
      throw new Error("Another Maket desktop instance owns this workspace");
    }
    if (!isProcessAlive(owner.pid)) return;
    const describeProcess = this.options.describeProcess ?? readProcessCommand;
    if (!looksLikeMaketServer(describeProcess(owner.pid))) {
      this.forgetOwnershipRecord(owner);
      return;
    }

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

    this.forgetOwnershipRecord(owner);
  }

  /** Drop the record that named `owner`, leaving records owned by others alone. */
  private forgetOwnershipRecord(owner: RuntimeOwner): void {
    if (owner.owner === "legacy") {
      if (readLegacyPid(owner.dataDir) === owner.pid) {
        rmSync(join(owner.dataDir, "server.pid"), { force: true });
      }
      return;
    }
    const current = readRuntimeDescriptor(owner.dataDir);
    if (current && current.pid === owner.pid) {
      removeRuntimeDescriptor(owner.dataDir, current.instanceId);
    }
  }

  async switchTo(workspace: string): Promise<void> {
    const target = resolve(workspace);
    if (target === this.workspace) return;
    const previous = this.workspace;
    try {
      await this.stop();
      await this.start(target);
    } catch (error) {
      if (this.server) throw error;
      try {
        await this.start(previous);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Failed to switch to ${target} and restore ${previous}`);
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    const instanceId = this.instanceId;
    const workspace = this.workspace;
    if (!server) return;
    let closeError: unknown;
    try {
      await server.close();
    } catch (error) {
      closeError = error;
    }
    if (!closeError || server.closed) {
      this.server = null;
      this.instanceId = null;
      if (instanceId) removeRuntimeDescriptor(workspace, instanceId);
    }
    if (closeError) throw closeError;
  }
}
