import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import type { DesktopUpdateChannel } from "@maket/shared";
import { DebUpdater, RpmUpdater } from "electron-updater";
import { DESKTOP_UPDATE_ROOT } from "./sparkle-updater.js";
import { waitForUpdateQuit } from "./update-relaunch.js";

/** Use the manager that owns this executable, not merely the distro name. */
export function installedLinuxPackage(executable = realpathSync(process.execPath)): "deb" | "rpm" {
  for (const [kind, command, args] of [
    ["deb", "dpkg-query", ["-S", executable]],
    ["rpm", "rpm", ["-qf", executable]],
  ] as const) {
    const result = spawnSync(command, [...args], { encoding: "utf8", timeout: 5000 });
    if (result.status === 0 && result.stdout.trim()) return kind;
  }
  throw new Error("Maket is not installed through a supported DEB or RPM package");
}

export class LinuxUpdater extends EventEmitter {
  private updater: DebUpdater | RpmUpdater | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly arch: string) {
    super();
  }

  // This adapter owns the native engine configuration and translates its events.
  // code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
  start(channel: DesktopUpdateChannel): void {
    this.stopUpdates();
    if (!this.updater) {
      const Updater = installedLinuxPackage() === "deb" ? DebUpdater : RpmUpdater;
      this.updater = new Updater({ provider: "generic", url: `${DESKTOP_UPDATE_ROOT}/${channel}/linux/${this.arch}` });
      this.updater.autoInstallOnAppQuit = false;
      this.updater.on("checking-for-update", () => this.emit("checking-for-update"));
      this.updater.on("update-available", (info) => this.emit("update-available", info.version));
      this.updater.on("download-progress", (info) => this.emit("download-progress", info.percent));
      this.updater.on("update-downloaded", (info) =>
        this.emit("update-downloaded", undefined, undefined, info.version),
      );
      this.updater.on("update-not-available", () => this.emit("update-not-available"));
      this.updater.on("error", (error) => this.emit("error", error));
    }
    this.updater.setFeedURL({ provider: "generic", url: `${DESKTOP_UPDATE_ROOT}/${channel}/linux/${this.arch}` });
    this.updater.allowPrerelease = channel === "candidate";
    this.updater.allowDowngrade = false;
    void this.checkForUpdates().catch(() => {});
    this.timer = setInterval(() => void this.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
    this.timer.unref();
  }

  async checkForUpdates(): Promise<void> {
    if (!this.updater) throw new Error("Linux updater is not initialized");
    await this.updater.checkForUpdates();
  }

  quitAndInstall(): Promise<void> {
    if (!this.updater) throw new Error("Linux updater is not initialized");
    return waitForUpdateQuit(this, () => this.updater?.quitAndInstall(false, true));
  }

  stopUpdates(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
