import { describe, expect, it, vi } from "vitest";
import { handleSquirrelStartup } from "./squirrel-startup.js";

describe("handleSquirrelStartup", () => {
  it("ignores Squirrel commands outside Windows", () => {
    const quit = vi.fn();
    expect(
      handleSquirrelStartup({
        platform: "darwin",
        command: "--squirrel-install",
        execPath: "/Applications/Maket.app/Contents/MacOS/Maket",
        quit,
      }),
    ).toBe(false);
    expect(quit).not.toHaveBeenCalled();
  });

  it.each([
    ["--squirrel-install", "--createShortcut=Maket.exe"],
    ["--squirrel-updated", "--createShortcut=Maket.exe"],
    ["--squirrel-uninstall", "--removeShortcut=Maket.exe"],
  ])("handles %s and quits after Update.exe finishes", (command, expectedArgument) => {
    const listeners = new Map<string, () => void>();
    const spawn = vi.fn(() => ({
      once(event: "close" | "error", listener: () => void) {
        listeners.set(event, listener);
      },
    }));
    const quit = vi.fn();

    expect(
      handleSquirrelStartup({
        platform: "win32",
        command,
        execPath: "/Maket/current/Maket.exe",
        quit,
        spawn,
      }),
    ).toBe(true);
    expect(spawn).toHaveBeenCalledWith("/Maket/Update.exe", [expectedArgument], { detached: true });
    expect(quit).not.toHaveBeenCalled();

    listeners.get("close")?.();
    listeners.get("error")?.();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("quits obsolete versions without spawning Update.exe", () => {
    const spawn = vi.fn();
    const quit = vi.fn();
    expect(
      handleSquirrelStartup({
        platform: "win32",
        command: "--squirrel-obsolete",
        execPath: "/Maket/current/Maket.exe",
        quit,
        spawn,
      }),
    ).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
  });
});
