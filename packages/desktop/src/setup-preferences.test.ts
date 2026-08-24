import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopSetupPreferences } from "./setup-preferences.js";

describe("desktop setup preferences", () => {
  it("requires onboarding until it is explicitly completed", () => {
    const path = join(mkdtempSync(join(tmpdir(), "maket-setup-")), "setup.json");
    const preferences = new DesktopSetupPreferences(path);

    expect(preferences.isRequired()).toBe(true);
    preferences.complete();
    expect(preferences.isRequired()).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      schemaVersion: 1,
      completed: true,
      awaitingClaudeDesktop: false,
    });
  });

  it("keeps Claude Desktop confirmation pending across restarts", () => {
    const path = join(mkdtempSync(join(tmpdir(), "maket-setup-")), "setup.json");
    const preferences = new DesktopSetupPreferences(path);

    preferences.awaitClaudeDesktop();

    expect(new DesktopSetupPreferences(path).isRequired()).toBe(true);
    expect(new DesktopSetupPreferences(path).isAwaitingClaudeDesktop()).toBe(true);
  });
});
