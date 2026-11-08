import { EventEmitter } from "node:events";
import type { SparkleBridge, SparkleBridgeEvent } from "electron-sparkle-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { application } = vi.hoisted(() => ({ application: { once: vi.fn(), removeListener: vi.fn() } }));
vi.mock("electron", () => ({ app: application }));

import { SparkleUpdater } from "./sparkle-updater.js";
import { waitForUpdateQuit } from "./update-relaunch.js";

beforeEach(() => vi.clearAllMocks());

describe("Sparkle update bridge", () => {
  it("downloads a major release, exposes progress, then requests native installation", async () => {
    let emit: ((event: SparkleBridgeEvent) => void) | null = null;
    const bridge: SparkleBridge = {
      init: vi.fn(() => true),
      checkForUpdates: vi.fn(),
      installUpdateNow: vi.fn(),
      installUpdateOnQuit: vi.fn(),
      discardDownloadedUpdate: vi.fn(),
      setAutomaticChecks: vi.fn(),
      setEventHandler: (callback) => {
        emit = callback;
      },
    };
    const updater = new SparkleUpdater("arm64", () => bridge);
    const ready = vi.fn(),
      progress = vi.fn();
    updater.on("update-downloaded", ready);
    updater.on("download-progress", progress);
    updater.start("candidate");
    expect(bridge.init).toHaveBeenCalledWith({
      appcastUrl: "https://ng-galien.github.io/maket/updates/candidate/darwin/arm64/appcast.xml",
    });
    const send = (event: SparkleBridgeEvent) => emit?.(event);
    send({ type: "update-available", version: "3.0.0" });
    send({ type: "download-progress", percent: 42 });
    send({ type: "update-downloaded", version: "3.0.0" });
    expect(progress).toHaveBeenCalledWith(42);
    expect(ready).toHaveBeenCalledWith(undefined, undefined, "3.0.0");
    const installed = updater.quitAndInstall();
    expect(bridge.installUpdateNow).toHaveBeenCalledOnce();
    const quitting = application.once.mock.calls.find(([event]) => event === "before-quit")?.[1];
    quitting();
    await installed;
    updater.stopUpdates();
    expect(bridge.setAutomaticChecks).toHaveBeenLastCalledWith(false);
  });

  it("reports an installer failure instead of pretending the app restarted", async () => {
    const events = new EventEmitter();
    const result = waitForUpdateQuit(events, () =>
      queueMicrotask(() => events.emit("error", new Error("Signature invalid"))),
    );
    await expect(result).rejects.toThrow("Signature invalid");
    expect(events.listenerCount("error")).toBe(0);
    expect(application.removeListener).toHaveBeenCalledWith("before-quit", expect.any(Function));
  });
});
