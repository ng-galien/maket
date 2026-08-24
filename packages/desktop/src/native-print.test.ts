import { describe, expect, it, vi } from "vitest";
import { desktopPrintUrl, type NativePrintWindow, printWithNativeDialog } from "./native-print.js";

describe("native document printing", () => {
  it("loads the internal print route and opens the native dialog", async () => {
    const destroy = vi.fn();
    const loadURL = vi.fn(async () => undefined);
    const print = vi.fn((_options, callback) => callback(true, ""));
    const printWindow: NativePrintWindow = {
      loadURL,
      isDestroyed: () => false,
      destroy,
      webContents: { print },
    };

    await printWithNativeDialog("http://127.0.0.1:24842", "Été 2026", () => printWindow);

    expect(loadURL).toHaveBeenCalledWith("http://127.0.0.1:24842/print?name=%C3%89t%C3%A9+2026&auto_print=false");
    expect(print).toHaveBeenCalledWith({ silent: false, printBackground: true }, expect.any(Function));
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys the internal window when printing fails", async () => {
    const destroy = vi.fn();
    const printWindow: NativePrintWindow = {
      loadURL: vi.fn(async () => undefined),
      isDestroyed: () => false,
      destroy,
      webContents: {
        print: (_options, callback) => callback(false, "Printer unavailable"),
      },
    };

    await expect(printWithNativeDialog("http://127.0.0.1:24842", "Poster", () => printWindow)).rejects.toThrow(
      "Printer unavailable",
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("keeps browser auto-printing out of the Electron URL", () => {
    expect(desktopPrintUrl("http://127.0.0.1:24842", "Poster")).toContain("auto_print=false");
  });
});
