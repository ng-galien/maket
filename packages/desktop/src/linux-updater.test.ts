import { beforeEach, describe, expect, it, vi } from "vitest";

const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: command }));
vi.mock("electron-updater", () => ({ DebUpdater: class {}, RpmUpdater: class {} }));
vi.mock("electron", () => ({ app: {} }));

import { installedLinuxPackage } from "./linux-updater.js";

beforeEach(() => command.mockReset());
describe("installed Linux update format", () => {
  it("uses ownership of the executable to select DEB", () => {
    command.mockReturnValue({ status: 0, stdout: "maket-app: /usr/lib/maket-app/Maket" });
    expect(installedLinuxPackage("/usr/lib/maket-app/Maket")).toBe("deb");
    expect(command).toHaveBeenCalledWith("dpkg-query", ["-S", "/usr/lib/maket-app/Maket"], expect.any(Object));
  });
  it("uses RPM when dpkg does not own the executable", () => {
    command
      .mockReturnValueOnce({ status: 1, stdout: "" })
      .mockReturnValueOnce({ status: 0, stdout: "maket-app-2.3.0" });
    expect(installedLinuxPackage("/usr/lib/maket-app/Maket")).toBe("rpm");
  });
  it("refuses to run a package updater for an unpackaged executable", () => {
    command.mockReturnValue({ status: 1, stdout: "" });
    expect(() => installedLinuxPackage("/tmp/Maket")).toThrow("not installed");
  });
});
