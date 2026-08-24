import { beforeEach, describe, expect, it, vi } from "vitest";

const { updater } = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    updater: {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      }),
      emit: (event: string, ...args: unknown[]) => {
        for (const listener of listeners.get(event) ?? []) listener(...args);
      },
      removeAllListeners: () => listeners.clear(),
      checkForUpdates: vi.fn(async () => undefined),
      quitAndInstall: vi.fn(),
    },
  };
});

vi.mock("electron", () => ({
  app: { getVersion: () => "2.0.0" },
  autoUpdater: updater,
}));

import { UpdateController, updateSourceFor } from "./update-controller.js";

beforeEach(() => {
  updater.removeAllListeners();
  updater.checkForUpdates.mockClear();
  updater.quitAndInstall.mockClear();
});

describe("UpdateController", () => {
  it("does not contact the update service for a local installer build", async () => {
    const startUpdates = vi.fn(() => ({ stopUpdates: vi.fn() }));
    const controller = new UpdateController({
      enabled: false,
      disabledReason: "local-build",
      preferences: { getChannel: () => "stable", setChannel: vi.fn() },
      startUpdates,
    });

    controller.start();
    await controller.check();

    expect(startUpdates).not.toHaveBeenCalled();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      status: "unavailable",
      reason: "local-build",
    });
  });

  it("treats an unreachable release service as neutral unavailability", async () => {
    const controller = new UpdateController({
      enabled: true,
      preferences: { getChannel: () => "stable", setChannel: vi.fn() },
      startUpdates: () => ({ stopUpdates: vi.fn() }),
    });
    updater.checkForUpdates.mockRejectedValueOnce(new Error("invalid response"));
    controller.start();
    updater.emit("update-not-available");

    await controller.check();

    expect(controller.getState()).toMatchObject({
      status: "unavailable",
      reason: "service-unavailable",
    });
  });

  it("uses the public Electron service for stable releases", () => {
    expect(updateSourceFor("stable", "darwin", "arm64")).toMatchObject({
      repo: "ng-galien/maket",
    });
  });

  it("uses the channel-specific static feed for release candidates", () => {
    expect(updateSourceFor("candidate", "win32", "x64")).toMatchObject({
      baseUrl: "https://ng-galien.github.io/maket/updates/candidate/win32/x64",
    });
  });

  it("restarts the update loop when the selected channel changes", () => {
    let channel: "stable" | "candidate" = "stable";
    const stopUpdates = vi.fn();
    const startUpdates = vi.fn(() => ({ stopUpdates }));
    const controller = new UpdateController({
      enabled: true,
      preferences: {
        getChannel: () => channel,
        setChannel: (next) => {
          channel = next;
        },
      },
      currentVersion: "2.0.0",
      platform: "darwin",
      arch: "arm64",
      startUpdates,
    });

    controller.start();
    updater.emit("update-not-available");
    controller.setChannel("candidate");

    expect(stopUpdates).toHaveBeenCalledOnce();
    expect(startUpdates).toHaveBeenLastCalledWith(
      expect.objectContaining({
        updateSource: expect.objectContaining({
          baseUrl: expect.stringContaining("/candidate/darwin/arm64"),
        }),
      }),
    );
    expect(controller.getState()).toMatchObject({
      channel: "candidate",
      currentVersion: "2.0.0",
      status: "checking",
    });
  });

  it("does not change channels while an update is being downloaded", () => {
    const setChannel = vi.fn();
    const controller = new UpdateController({
      enabled: true,
      preferences: { getChannel: () => "stable", setChannel },
      startUpdates: () => ({ stopUpdates: vi.fn() }),
    });
    controller.start();
    updater.emit("update-available");

    expect(() => controller.setChannel("candidate")).toThrow("cannot change while an update is in progress");
    expect(setChannel).not.toHaveBeenCalled();
  });

  it("exposes downloaded updates and installs only when ready", () => {
    const controller = new UpdateController({
      enabled: true,
      preferences: { getChannel: () => "stable", setChannel: vi.fn() },
      startUpdates: () => ({ stopUpdates: vi.fn() }),
    });
    controller.start();

    updater.emit("update-downloaded", {}, "notes", "2.1.0");
    expect(controller.getState()).toMatchObject({ status: "ready", version: "2.1.0" });
    controller.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("invalidates a prepared installation if updater state changes", () => {
    const controller = new UpdateController({
      enabled: true,
      preferences: { getChannel: () => "stable", setChannel: vi.fn() },
      startUpdates: () => ({ stopUpdates: vi.fn() }),
    });
    controller.start();
    updater.emit("update-downloaded", {}, "notes", "2.1.0");
    const install = controller.prepareInstall();
    updater.emit("error", new Error("download invalidated"));

    expect(install).toThrow("no longer ready");
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
