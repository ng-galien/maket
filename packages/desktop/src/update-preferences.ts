import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DesktopUpdateChannel } from "@maket/shared";

interface DesktopPreferencesData {
  updateChannel?: DesktopUpdateChannel;
}

export class UpdatePreferences {
  constructor(private readonly path: string) {}

  getChannel(): DesktopUpdateChannel {
    const value = this.read().updateChannel;
    return value === "candidate" ? "candidate" : "stable";
  }

  setChannel(channel: DesktopUpdateChannel): void {
    const preferences = this.read();
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify({ ...preferences, updateChannel: channel }, null, 2)}\n`, "utf8");
  }

  private read(): DesktopPreferencesData {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
}
