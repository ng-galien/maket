import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readRuntimeDescriptor,
  removeRuntimeDescriptor,
  runtimeDescriptorPath,
  writeRuntimeDescriptor,
} from "./descriptor.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime descriptor", () => {
  it("writes a private ownership record and removes only the matching instance", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "maket-runtime-"));
    directories.push(dataDir);
    const descriptor = {
      schemaVersion: 1 as const,
      owner: "electron" as const,
      pid: 42,
      host: "127.0.0.1",
      port: 24842,
      dataDir,
      version: "2.0.0",
      instanceId: "desktop-instance",
      startedAt: "2026-08-21T00:00:00.000Z",
    };

    writeRuntimeDescriptor(descriptor);

    expect(readRuntimeDescriptor(dataDir)).toEqual(descriptor);
    expect(statSync(runtimeDescriptorPath(dataDir)).mode & 0o777).toBe(0o600);
    expect(removeRuntimeDescriptor(dataDir, "another-instance")).toBe(false);
    expect(removeRuntimeDescriptor(dataDir, descriptor.instanceId)).toBe(true);
    expect(readRuntimeDescriptor(dataDir)).toBeNull();
  });

  it("rejects an invalid ownership record", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "maket-runtime-invalid-"));
    directories.push(dataDir);
    const path = runtimeDescriptorPath(dataDir);
    writeRuntimeDescriptor({
      schemaVersion: 1,
      owner: "headless",
      pid: 1,
      host: "127.0.0.1",
      port: 24842,
      dataDir,
      version: "2.0.0",
      instanceId: "valid-first",
      startedAt: "2026-08-21T00:00:00.000Z",
    });
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    raw.owner = "unknown";
    writeFileSync(path, JSON.stringify(raw));

    expect(readRuntimeDescriptor(dataDir)).toBeNull();
  });
});
