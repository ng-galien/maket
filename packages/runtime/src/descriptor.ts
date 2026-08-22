import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RUNTIME_DESCRIPTOR_FILE = "runtime.json";

export interface RuntimeDescriptor {
  schemaVersion: 1;
  owner: "electron" | "headless";
  pid: number;
  host: string;
  port: number;
  dataDir: string;
  version: string;
  instanceId: string;
  startedAt: string;
}

export function runtimeDescriptorPath(dataDir: string): string {
  return join(dataDir, RUNTIME_DESCRIPTOR_FILE);
}

export function readRuntimeDescriptor(dataDir: string): RuntimeDescriptor | null {
  const path = runtimeDescriptorPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeDescriptor>;
    if (
      value.schemaVersion !== 1 ||
      (value.owner !== "electron" && value.owner !== "headless") ||
      !Number.isSafeInteger(value.pid) ||
      (value.pid ?? 0) <= 0 ||
      typeof value.host !== "string" ||
      !Number.isSafeInteger(value.port) ||
      (value.port ?? 0) <= 0 ||
      typeof value.dataDir !== "string" ||
      typeof value.version !== "string" ||
      typeof value.instanceId !== "string" ||
      typeof value.startedAt !== "string"
    ) {
      return null;
    }
    return value as RuntimeDescriptor;
  } catch {
    return null;
  }
}

export function writeRuntimeDescriptor(descriptor: RuntimeDescriptor): void {
  const path = runtimeDescriptorPath(descriptor.dataDir);
  const temporary = `${path}.${descriptor.instanceId}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export function removeRuntimeDescriptor(dataDir: string, instanceId: string): boolean {
  const current = readRuntimeDescriptor(dataDir);
  if (!current || current.instanceId !== instanceId) return false;
  rmSync(runtimeDescriptorPath(dataDir), { force: true });
  return true;
}
