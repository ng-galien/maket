import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UpdatePreferences } from "./update-preferences.js";

describe("UpdatePreferences", () => {
  it("defaults to stable and persists the selected channel", () => {
    const path = join(mkdtempSync(join(tmpdir(), "maket-update-preferences-")), "desktop.json");
    const preferences = new UpdatePreferences(path);

    expect(preferences.getChannel()).toBe("stable");
    preferences.setChannel("candidate");

    expect(new UpdatePreferences(path).getChannel()).toBe("candidate");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ updateChannel: "candidate" });
  });

  it("falls back to stable when the persisted file is invalid", () => {
    const path = join(mkdtempSync(join(tmpdir(), "maket-update-preferences-")), "desktop.json");
    writeFileSync(path, "not json", "utf8");
    expect(new UpdatePreferences(path).getChannel()).toBe("stable");
  });
});
