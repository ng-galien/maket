import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DesktopUpdateChannel } from "@maket/shared";
import type { SparkleBridge, SparkleBridgeEvent } from "electron-sparkle-updater";
import { waitForUpdateQuit } from "./update-relaunch.js";

export const DESKTOP_UPDATE_ROOT = "https://ng-galien.github.io/maket/updates";

/** Sparkle authenticates archives with the Ed25519 key embedded in Info.plist. */
export class SparkleUpdater extends EventEmitter {
  private bridge: SparkleBridge | null = null;

  constructor(
    private readonly arch: string,
    private readonly load: () => SparkleBridge = () =>
      createRequire(import.meta.url)(join(process.resourcesPath, "sparkle_bridge.node")),
  ) {
    super();
  }

  start(channel: DesktopUpdateChannel): void {
    this.bridge ??= this.load();
    this.bridge.setEventHandler((event) => this.onBridgeEvent(event));
    const appcastUrl = `${DESKTOP_UPDATE_ROOT}/${channel}/darwin/${this.arch}/appcast.xml`;
    if (!this.bridge.init({ appcastUrl })) throw new Error("Sparkle could not initialize the update service");
    this.bridge.setAutomaticChecks(true);
    this.bridge.checkForUpdates();
  }

  checkForUpdates(): void {
    if (!this.bridge) throw new Error("Sparkle is not initialized");
    this.bridge.checkForUpdates();
  }

  quitAndInstall(): Promise<void> {
    if (!this.bridge) throw new Error("Sparkle is not initialized");
    return waitForUpdateQuit(this, () => this.bridge?.installUpdateNow());
  }

  stopUpdates(): void {
    this.bridge?.setAutomaticChecks(false);
  }

  private onBridgeEvent(event: SparkleBridgeEvent): void {
    switch (event.type) {
      case "checking":
        this.emit("checking-for-update");
        break;
      case "update-available":
        this.emit("update-available", event.version);
        break;
      case "download-progress":
        this.emit("download-progress", event.percent);
        break;
      case "update-downloaded":
        this.emit("update-downloaded", undefined, undefined, event.version);
        break;
      case "update-not-available":
        this.emit("update-not-available");
        break;
      case "error":
        this.emit("error", new Error(event.message ?? "Sparkle update failed"));
        break;
    }
  }
}
