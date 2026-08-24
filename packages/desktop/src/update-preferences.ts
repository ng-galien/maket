import { readSettingsFile, writeSettingsFile } from "@maket/server";
import type { DesktopUpdateChannel } from "@maket/shared";

/**
 * The update channel lives in the user-level settings file alongside the panel
 * preferences, so the Settings page and the updater read the same value. The
 * main process needs it before the embedded server exists, hence the direct
 * file access rather than a runtime service.
 */
export class UpdatePreferences {
  constructor(private readonly path: string) {}

  getChannel(): DesktopUpdateChannel {
    return readSettingsFile(this.path).updateChannel;
  }

  setChannel(channel: DesktopUpdateChannel): void {
    writeSettingsFile(this.path, {
      ...readSettingsFile(this.path),
      updateChannel: channel,
    });
  }
}
