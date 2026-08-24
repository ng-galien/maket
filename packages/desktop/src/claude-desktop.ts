import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeDesktopConfiguration } from "@maket/shared";

export const MAKET_CLAUDE_DESKTOP_EXTENSION_ID = "local.mcpb.alexandre-boyer.maket-app-bridge";

export interface ClaudeDesktopInspectionOptions {
  applicationDetected: boolean;
  bundlePath: string;
  bundledVersion: string;
  claudeRoot: string;
}

interface InstalledExtension {
  version?: string;
  hash?: string;
}

export function inspectClaudeDesktop(options: ClaudeDesktopInspectionOptions): ClaudeDesktopConfiguration {
  const extensionRoot = join(options.claudeRoot, "Claude Extensions", MAKET_CLAUDE_DESKTOP_EXTENSION_ID);
  const detected = options.applicationDetected || existsSync(options.claudeRoot) || existsSync(extensionRoot);
  const base = {
    client: "claude-desktop" as const,
    name: "Claude Desktop",
    detected,
    bundledVersion: options.bundledVersion,
  };
  if (!detected) return { ...base, status: "not-detected" };

  const installation = readInstalledExtension(options.claudeRoot, extensionRoot);
  if (installation === "unknown") return { ...base, status: "unknown" };
  if (!installation) return { ...base, status: "missing" };

  const bundledHash = hashFile(options.bundlePath);
  const sameVersion = installation.version === options.bundledVersion;
  const sameBundle = !installation.hash || !bundledHash || installation.hash === bundledHash;
  return {
    ...base,
    status: sameVersion && sameBundle ? "valid" : "outdated",
    installedVersion: installation.version,
  };
}

function readInstalledExtension(claudeRoot: string, extensionRoot: string): InstalledExtension | "unknown" | null {
  const registryPath = join(claudeRoot, "extensions-installations.json");
  if (existsSync(registryPath)) {
    try {
      const registry = readObject(registryPath);
      const extensions = registry.extensions;
      if (extensions && typeof extensions === "object" && !Array.isArray(extensions)) {
        const installed = (extensions as Record<string, unknown>)[MAKET_CLAUDE_DESKTOP_EXTENSION_ID];
        if (installed && typeof installed === "object" && !Array.isArray(installed)) {
          const entry = installed as Record<string, unknown>;
          return {
            version: typeof entry.version === "string" ? entry.version : undefined,
            hash: typeof entry.hash === "string" ? entry.hash : undefined,
          };
        }
      }
    } catch {
      return readInstalledManifest(extensionRoot) ?? "unknown";
    }
  }
  return readInstalledManifest(extensionRoot);
}

function readInstalledManifest(extensionRoot: string): InstalledExtension | null {
  const manifestPath = join(extensionRoot, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = readObject(manifestPath);
    return { version: typeof manifest.version === "string" ? manifest.version : undefined };
  } catch {
    return null;
  }
}

function readObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected an object");
  return value as Record<string, unknown>;
}

function hashFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
