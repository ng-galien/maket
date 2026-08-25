import { describe, expect, it, vi } from "vitest";
import { installDesktopUpdate } from "./update-install.js";

describe("desktop update installation", () => {
  it("validates the update before stopping the runtime", async () => {
    const stopRuntime = vi.fn(async () => undefined);

    await expect(
      installDesktopUpdate({
        prepareInstall: () => {
          throw new Error("No update ready");
        },
        stopRuntime,
        startRuntime: vi.fn(async () => undefined),
        setQuitting: vi.fn(),
      }),
    ).rejects.toThrow("No update ready");
    expect(stopRuntime).not.toHaveBeenCalled();
  });

  it("restarts the runtime when the updater fails after shutdown", async () => {
    const events: string[] = [];
    await expect(
      installDesktopUpdate({
        prepareInstall: () => () => {
          events.push("install");
          throw new Error("updater failed");
        },
        stopRuntime: async () => {
          events.push("stop");
        },
        startRuntime: async () => {
          events.push("restart");
        },
        setQuitting: (value) => events.push(`quitting:${value}`),
      }),
    ).rejects.toThrow("updater failed");
    expect(events).toEqual(["quitting:true", "stop", "install", "quitting:false", "restart"]);
  });

  it("keeps the runtime stopped after handing control to the updater", async () => {
    const startRuntime = vi.fn(async () => undefined);
    const install = vi.fn();
    await installDesktopUpdate({
      prepareInstall: () => install,
      stopRuntime: vi.fn(async () => undefined),
      startRuntime,
      setQuitting: vi.fn(),
    });
    expect(install).toHaveBeenCalledOnce();
    expect(startRuntime).not.toHaveBeenCalled();
  });
});
