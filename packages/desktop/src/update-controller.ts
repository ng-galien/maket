import type { DesktopUpdateChannel, DesktopUpdateReason, DesktopUpdateState } from "@maket/shared";
import { app, autoUpdater, type BrowserWindow } from "electron";
import {
  type IUpdateElectronApp,
  type IUpdateElectronAppOptions,
  UpdateSourceType,
  updateElectronApp,
} from "update-electron-app";
import type { UpdatePreferences } from "./update-preferences.js";

const UPDATE_REPOSITORY = "ng-galien/maket";
const CANDIDATE_UPDATE_ROOT = "https://ng-galien.github.io/maket/updates/candidate";

interface UpdateControllerOptions {
  enabled: boolean;
  disabledReason?: DesktopUpdateReason;
  preferences: Pick<UpdatePreferences, "getChannel" | "setChannel">;
  currentVersion?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  startUpdates?: (options: IUpdateElectronAppOptions) => IUpdateElectronApp;
}

export class UpdateController {
  private state: DesktopUpdateState;
  private windows = new Set<BrowserWindow>();
  private started = false;
  private updateLoop: IUpdateElectronApp | null = null;
  private readonly currentVersion: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly startUpdates: (options: IUpdateElectronAppOptions) => IUpdateElectronApp;

  constructor(private readonly options: UpdateControllerOptions) {
    this.currentVersion = options.currentVersion ?? app.getVersion();
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.startUpdates = options.startUpdates ?? updateElectronApp;
    this.state = this.baseState("idle");
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.options.enabled) {
      this.publish({
        ...this.baseState("unavailable"),
        reason: this.options.disabledReason ?? "development-build",
      });
      return;
    }
    autoUpdater.on("checking-for-update", () => this.publish(this.baseState("checking")));
    autoUpdater.on("update-available", () => this.publish(this.baseState("downloading")));
    autoUpdater.on("update-not-available", () => this.publish(this.baseState("up-to-date")));
    autoUpdater.on("update-downloaded", (_event, _notes, version) =>
      this.publish({ ...this.baseState("ready"), version }),
    );
    autoUpdater.on("error", (error) => this.publishUnavailable(error));
    this.startUpdateLoop();
  }

  attach(window: BrowserWindow): void {
    this.windows.add(window);
    window.once("closed", () => this.windows.delete(window));
  }

  getState(): DesktopUpdateState {
    return this.state;
  }

  getChannel(): DesktopUpdateChannel {
    return this.options.preferences.getChannel();
  }

  setChannel(channel: DesktopUpdateChannel): DesktopUpdateState {
    if (channel === this.getChannel()) return this.state;
    if (this.state.status === "checking" || this.state.status === "downloading" || this.state.status === "ready") {
      throw new Error("The update channel cannot change while an update is in progress");
    }
    this.options.preferences.setChannel(channel);
    this.publish(this.baseState("idle"));
    if (this.started && this.options.enabled) this.startUpdateLoop();
    return this.state;
  }

  async check(): Promise<void> {
    if (!this.options.enabled) {
      this.publish({
        ...this.baseState("unavailable"),
        reason: this.options.disabledReason ?? "development-build",
      });
      return;
    }
    if (this.state.status === "checking" || this.state.status === "downloading") return;
    this.publish(this.baseState("checking"));
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.publishUnavailable(error);
    }
  }

  install(): void {
    this.prepareInstall()();
  }

  prepareInstall(): () => void {
    if (this.state.status !== "ready") {
      throw new Error("No Maket App update is ready to install");
    }
    const channel = this.state.channel;
    const version = this.state.version;
    return () => {
      if (this.state.status !== "ready" || this.state.channel !== channel || this.state.version !== version) {
        throw new Error("The downloaded Maket App update is no longer ready to install");
      }
      autoUpdater.quitAndInstall();
    };
  }

  private startUpdateLoop(): void {
    this.updateLoop?.stopUpdates();
    this.publish(this.baseState("checking"));
    this.updateLoop = this.startUpdates({
      updateSource: updateSourceFor(this.getChannel(), this.platform, this.arch),
      updateInterval: "1 hour",
      notifyUser: false,
      logger: updateLogger,
    });
  }

  private baseState(status: DesktopUpdateState["status"]): DesktopUpdateState {
    return {
      status,
      channel: this.getChannel(),
      currentVersion: this.currentVersion,
    };
  }

  private publish(state: DesktopUpdateState): void {
    this.state = state;
    for (const window of this.windows) {
      window.webContents.send("maket:update:state-changed", state);
    }
  }

  private publishUnavailable(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    updateLogger.warn(`Update service unavailable: ${detail}`);
    this.publish({
      ...this.baseState("unavailable"),
      reason: "service-unavailable",
    });
  }
}

export function updateSourceFor(
  channel: DesktopUpdateChannel,
  platform: NodeJS.Platform,
  arch: string,
): IUpdateElectronAppOptions["updateSource"] {
  if (channel === "candidate") {
    return {
      type: UpdateSourceType.StaticStorage,
      baseUrl: `${CANDIDATE_UPDATE_ROOT}/${platform}/${arch}`,
    };
  }
  return {
    type: UpdateSourceType.ElectronPublicUpdateService,
    repo: UPDATE_REPOSITORY,
  };
}

const updateLogger = {
  log: (message: string) => process.stderr.write(`[desktop:update] ${message}\n`),
  info: (message: string) => process.stderr.write(`[desktop:update] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[desktop:update] ${message}\n`),
  error: (message: string) => process.stderr.write(`[desktop:update] ${message}\n`),
};
