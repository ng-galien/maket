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
      webContents: { print, executeJavaScript: vi.fn(async () => ({ width: 297, height: 210 })) },
    };

    await printWithNativeDialog("http://127.0.0.1:24842", "Été 2026", () => printWindow);

    expect(loadURL).toHaveBeenCalledWith("http://127.0.0.1:24842/print?name=%C3%89t%C3%A9+2026&auto_print=false");
    expect(print).toHaveBeenCalledWith(
      {
        silent: false,
        printBackground: true,
        landscape: true,
        pageSize: { width: 210000, height: 297000 },
        margins: { marginType: "none" },
      },
      expect.any(Function),
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys the internal window when printing fails", async () => {
    const destroy = vi.fn();
    const printWindow: NativePrintWindow = {
      loadURL: vi.fn(async () => undefined),
      isDestroyed: () => false,
      destroy,
      webContents: {
        executeJavaScript: vi.fn(async () => ({ width: 210, height: 297 })),
        print: (_options, callback) => callback(false, "Printer unavailable"),
      },
    };

    await expect(printWithNativeDialog("http://127.0.0.1:24842", "Poster", () => printWindow)).rejects.toThrow(
      "Printer unavailable",
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([
    { width: 148, height: 210, landscape: false, paper: { width: 148000, height: 210000 } },
    { width: 420, height: 297, landscape: true, paper: { width: 297000, height: 420000 } },
    { width: 100, height: 100, landscape: false, paper: { width: 100000, height: 100000 } },
  ])(
    "uses the document's $width × $height mm page in the native dialog",
    async ({ width, height, landscape, paper }) => {
      const print = vi.fn((_options, callback) => callback(false, "Print job canceled"));
      const destroy = vi.fn();
      await printWithNativeDialog("http://127.0.0.1:24842", "Format", () => ({
        loadURL: vi.fn(async () => undefined),
        isDestroyed: () => false,
        destroy,
        webContents: { print, executeJavaScript: vi.fn(async () => ({ width, height })) },
      }));
      expect(print).toHaveBeenCalledWith(expect.objectContaining({ landscape, pageSize: paper }), expect.any(Function));
      expect(destroy).toHaveBeenCalledOnce();
    },
  );

  it("keeps browser auto-printing out of the Electron URL", () => {
    expect(desktopPrintUrl("http://127.0.0.1:24842", "Poster")).toContain("auto_print=false");
  });
});
