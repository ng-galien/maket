import type { DesktopUpdateState } from "@maket/shared";
import { app, autoUpdater, type BrowserWindow } from "electron";
import { updateElectronApp } from "update-electron-app";

export class UpdateController {
  private state: DesktopUpdateState = { status: "idle" };
  private windows = new Set<BrowserWindow>();

  constructor(private readonly enabled = app.isPackaged) {}

  start(): void {
    if (!this.enabled) return;
    autoUpdater.on("checking-for-update", () => this.publish({ status: "checking" }));
    autoUpdater.on("update-available", () => this.publish({ status: "available" }));
    autoUpdater.on("update-not-available", () => this.publish({ status: "up-to-date" }));
    autoUpdater.on("update-downloaded", (_event, _notes, version) => this.publish({ status: "ready", version }));
    autoUpdater.on("error", (error) => this.publish({ status: "error", message: error.message }));
    updateElectronApp({ notifyUser: false });
  }

  attach(window: BrowserWindow): void {
    this.windows.add(window);
    window.once("closed", () => this.windows.delete(window));
  }

  getState(): DesktopUpdateState {
    return this.state;
  }

  async check(): Promise<void> {
    if (!this.enabled) {
      this.publish({
        status: "up-to-date",
        version: app.getVersion(),
        message: "Updates are disabled in development builds.",
      });
      return;
    }
    this.publish({ status: "checking" });
    await autoUpdater.checkForUpdates();
  }

  install(): void {
    if (this.state.status !== "ready") {
      throw new Error("No Maket update is ready to install");
    }
    autoUpdater.quitAndInstall();
  }

  private publish(state: DesktopUpdateState): void {
    this.state = state;
    for (const window of this.windows) {
      window.webContents.send("maket:update:state-changed", state);
    }
  }
}
