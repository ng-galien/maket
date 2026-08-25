import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSettingsFile } from "@maket/server";
import { DEFAULT_SETTINGS } from "@maket/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchDesktopLanguage } from "./i18n.js";

describe("desktop language synchronization", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("observes a settings write made by another process", async () => {
    const directory = mkdtempSync(join(tmpdir(), "maket-desktop-language-"));
    directories.push(directory);
    const settingsPath = join(directory, "settings.json");
    writeSettingsFile(settingsPath, DEFAULT_SETTINGS);
    const changed = vi.fn();
    const stop = watchDesktopLanguage(settingsPath, changed, 20);
    changed.mockClear();

    try {
      writeSettingsFile(settingsPath, { ...DEFAULT_SETTINGS, language: "fr" });
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith("fr"), {
        timeout: 1_000,
      });
    } finally {
      stop();
    }
  });

  it("synchronizes a change that happened before the watcher was installed", () => {
    const directory = mkdtempSync(join(tmpdir(), "maket-desktop-language-"));
    directories.push(directory);
    const settingsPath = join(directory, "settings.json");
    writeSettingsFile(settingsPath, { ...DEFAULT_SETTINGS, language: "fr" });
    const changed = vi.fn();

    const stop = watchDesktopLanguage(settingsPath, changed, 20);
    try {
      expect(changed).toHaveBeenCalledWith("fr");
    } finally {
      stop();
    }
  });
});
