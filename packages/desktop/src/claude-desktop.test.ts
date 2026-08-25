import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectClaudeDesktop, MAKET_CLAUDE_DESKTOP_EXTENSION_ID } from "./claude-desktop.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Claude Desktop installation inspection", () => {
  it("keeps the client visible when Claude Desktop is not detected", () => {
    const fixture = createFixture();

    expect(inspectClaudeDesktop(fixture.options)).toEqual({
      client: "claude-desktop",
      name: "Claude Desktop",
      detected: false,
      status: "not-detected",
      bundledVersion: "2.0.0",
    });
  });

  it("reports a missing bundle when Claude Desktop is installed", () => {
    const fixture = createFixture();

    expect(inspectClaudeDesktop({ ...fixture.options, applicationDetected: true })).toMatchObject({
      detected: true,
      status: "missing",
    });
  });

  it("requires the installed version and bundle hash to match Maket", () => {
    const fixture = createFixture();
    mkdirSync(fixture.claudeRoot, { recursive: true });
    writeRegistry(fixture.claudeRoot, {
      version: "2.0.0",
      hash: fixture.bundleHash,
    });

    expect(inspectClaudeDesktop(fixture.options)).toMatchObject({
      detected: true,
      status: "valid",
      bundledVersion: "2.0.0",
      installedVersion: "2.0.0",
    });

    writeRegistry(fixture.claudeRoot, {
      version: "2.0.0",
      hash: "different-bundle",
    });
    expect(inspectClaudeDesktop(fixture.options)).toMatchObject({
      status: "outdated",
      installedVersion: "2.0.0",
    });
  });

  it("reports an unreadable Claude registry instead of treating it as complete", () => {
    const fixture = createFixture();
    mkdirSync(fixture.claudeRoot, { recursive: true });
    writeFileSync(join(fixture.claudeRoot, "extensions-installations.json"), "not json");

    expect(inspectClaudeDesktop(fixture.options)).toMatchObject({
      detected: true,
      status: "unknown",
    });
  });
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "maket-claude-inspection-"));
  roots.push(root);
  const claudeRoot = join(root, "Claude");
  const bundlePath = join(root, "maket.mcpb");
  const bundle = "bundle-2.0.0";
  writeFileSync(bundlePath, bundle);
  return {
    claudeRoot,
    bundleHash: createHash("sha256").update(bundle).digest("hex"),
    options: {
      applicationDetected: false,
      bundlePath,
      bundledVersion: "2.0.0",
      claudeRoot,
    },
  };
}

function writeRegistry(claudeRoot: string, entry: { version: string; hash: string }): void {
  writeFileSync(
    join(claudeRoot, "extensions-installations.json"),
    JSON.stringify({
      extensions: { [MAKET_CLAUDE_DESKTOP_EXTENSION_ID]: entry },
    }),
  );
}
