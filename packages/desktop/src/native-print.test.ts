import { describe, expect, it, vi } from "vitest";
import {
  desktopPrintUrl,
  linuxDialogUnusableReason,
  type NativePrintHost,
  type NativePrintWindow,
  printWithNativeDialog,
  SHOW_TIMEOUT_MS,
} from "./native-print.js";

type PrintCallback = (success: boolean, failureReason: string) => void;

function fakeWindow(options: {
  size?: { width: number; height: number };
  print?: (callback: PrintCallback) => void;
  parent?: unknown;
  emitsShow?: boolean;
}) {
  const events: string[] = [];
  let visible = false;
  let destroyed = false;
  let printReturned = false;
  const showListeners: Array<() => void> = [];
  const window: NativePrintWindow = {
    loadURL: vi.fn(async () => undefined),
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    show: vi.fn(() => {
      visible = true;
      events.push("show");
      if (options.emitsShow === false) return;
      for (const listener of showListeners.splice(0)) listener();
    }),
    once: (_event, listener) => showListeners.push(listener),
    getParentWindow: () => ("parent" in options ? options.parent : { id: 1 }),
    destroy: vi.fn(() => {
      events.push(printReturned ? "destroy-after-print-returned" : "destroy");
      destroyed = true;
    }),
    webContents: {
      executeJavaScript: vi.fn(async () => options.size ?? { width: 297, height: 210 }),
      print: vi.fn((_printOptions, callback: PrintCallback) => {
        events.push(visible ? "print-visible" : "print-hidden");
        (options.print ?? ((done) => done(true, "")))(callback);
        printReturned = true;
      }),
      printToPDF: vi.fn(async () => {
        events.push("printToPDF");
        return new Uint8Array([37, 80, 68, 70]);
      }),
    },
  };
  return { window, events };
}

function fakeHost(
  window: NativePrintWindow,
  overrides: Partial<NativePrintHost> = {},
): NativePrintHost & { deferred: Array<() => void> } {
  const deferred: Array<() => void> = [];
  return {
    platform: "darwin",
    createWindow: () => window,
    unusableDialogReason: () => null,
    markDialogPending: vi.fn(),
    clearDialogPending: vi.fn(),
    openPdf: vi.fn(async (name: string) => `/tmp/maket-print/${name}.pdf`),
    defer: (task) => deferred.push(task),
    log: vi.fn(),
    deferred,
    ...overrides,
  };
}

const BASE = "http://127.0.0.1:24842";

describe("native document printing", () => {
  it("loads the internal print route and opens the native dialog", async () => {
    const { window } = fakeWindow({});
    const host = fakeHost(window);

    await expect(printWithNativeDialog(BASE, "Été 2026", host)).resolves.toEqual({ status: "printed" });

    expect(window.loadURL).toHaveBeenCalledWith(`${BASE}/print?name=%C3%89t%C3%A9+2026&auto_print=false`);
    expect(window.webContents.print).toHaveBeenCalledWith(
      {
        silent: false,
        printBackground: true,
        landscape: true,
        pageSize: { width: 210000, height: 297000 },
        margins: { marginType: "none" },
      },
      expect.any(Function),
    );
  });

  it("keeps the macOS and Windows window hidden, as explicitly allowed there", async () => {
    for (const platform of ["darwin", "win32"] as const) {
      const { window, events } = fakeWindow({});
      await printWithNativeDialog(BASE, "Poster", fakeHost(window, { platform }));
      expect(window.show).not.toHaveBeenCalled();
      expect(events[0]).toBe("print-hidden");
    }
  });

  it("shows the print window on Linux before print() is called", async () => {
    const { window, events } = fakeWindow({});
    const host = fakeHost(window, { platform: "linux" });

    await expect(printWithNativeDialog(BASE, "Poster", host)).resolves.toEqual({ status: "printed" });

    expect(events.slice(0, 2)).toEqual(["show", "print-visible"]);
    expect(host.markDialogPending).toHaveBeenCalledOnce();
    for (const task of host.deferred) task();
    expect(host.clearDialogPending).toHaveBeenCalledOnce();
  });

  it("keeps the Linux dialog marker until the print window has been destroyed", async () => {
    let marker = false;
    const { window } = fakeWindow({});
    const host = fakeHost(window, {
      platform: "linux",
      markDialogPending: vi.fn(() => {
        marker = true;
      }),
      clearDialogPending: vi.fn(() => {
        marker = false;
      }),
    });
    const markerAtDestroy: boolean[] = [];
    vi.mocked(window.destroy).mockImplementation(() => {
      markerAtDestroy.push(marker);
    });

    await expect(printWithNativeDialog(BASE, "Poster", host)).resolves.toEqual({ status: "printed" });
    expect(marker).toBe(true);

    for (const task of host.deferred) task();
    expect(markerAtDestroy).toEqual([true]);
    expect(marker).toBe(false);
  });

  it("fails and destroys the Linux print window when it is never shown", async () => {
    vi.useFakeTimers();
    try {
      const { window } = fakeWindow({ emitsShow: false });
      const host = fakeHost(window, { platform: "linux" });
      const pending = printWithNativeDialog(BASE, "Poster", host);
      await vi.advanceTimersByTimeAsync(SHOW_TIMEOUT_MS);

      await expect(pending).resolves.toEqual({
        status: "failed",
        message: `The print window was not shown within ${SHOW_TIMEOUT_MS} ms`,
      });
      expect(window.destroy).toHaveBeenCalledOnce();
      expect(window.webContents.print).not.toHaveBeenCalled();
      expect(host.markDialogPending).not.toHaveBeenCalled();
      for (const task of host.deferred) task();
      expect(window.destroy).toHaveBeenCalledOnce();
      expect(host.clearDialogPending).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to print from a window without a parent", async () => {
    const { window } = fakeWindow({ parent: null });
    const host = fakeHost(window);

    await expect(printWithNativeDialog(BASE, "Poster", host)).resolves.toEqual({
      status: "failed",
      message: "The print window has no parent window",
    });
    expect(window.webContents.print).not.toHaveBeenCalled();
  });

  it("returns a print() failure as a message instead of throwing", async () => {
    const { window } = fakeWindow({ print: (done) => done(false, "Printer unavailable") });
    await expect(printWithNativeDialog(BASE, "Poster", fakeHost(window))).resolves.toEqual({
      status: "failed",
      message: "Printer unavailable",
    });
  });

  it("returns an exception thrown by print() as a message", async () => {
    const { window } = fakeWindow({
      print: () => {
        throw new Error("print dialog exploded");
      },
    });
    await expect(printWithNativeDialog(BASE, "Poster", fakeHost(window))).resolves.toEqual({
      status: "failed",
      message: "print dialog exploded",
    });
  });

  it("returns a page that cannot be measured as a message", async () => {
    const { window } = fakeWindow({ size: { width: Number.NaN, height: 297 } });
    await expect(printWithNativeDialog(BASE, "Poster", fakeHost(window))).resolves.toEqual({
      status: "failed",
      message: "The document has an invalid print size",
    });
  });

  it("destroys the print window only after print() has returned, in a later task", async () => {
    const pendingPrint: { callback?: PrintCallback } = {};
    const { window, events } = fakeWindow({
      print: (done) => {
        pendingPrint.callback = done;
      },
    });
    const host = fakeHost(window);
    const pending = printWithNativeDialog(BASE, "Poster", host);
    await vi.waitFor(() => expect(pendingPrint.callback).toBeDefined());
    expect(window.destroy).not.toHaveBeenCalled();

    pendingPrint.callback?.(true, "");
    await pending;
    expect(window.destroy).not.toHaveBeenCalled();

    for (const task of host.deferred) task();
    expect(events).toEqual(["print-hidden", "destroy-after-print-returned"]);
  });

  it("destroys the print window after a failure too", async () => {
    const { window } = fakeWindow({ print: (done) => done(false, "Printer unavailable") });
    const host = fakeHost(window);
    await printWithNativeDialog(BASE, "Poster", host);
    for (const task of host.deferred) task();
    expect(window.destroy).toHaveBeenCalledOnce();
  });

  it("falls back to a PDF on Linux when the dialog is known to be unusable", async () => {
    const { window, events } = fakeWindow({ size: { width: 210, height: 297 } });
    const host = fakeHost(window, {
      platform: "linux",
      unusableDialogReason: () => "the print dialog stopped Maket during the previous attempt",
    });

    await expect(printWithNativeDialog(BASE, "Poster", host)).resolves.toEqual({
      status: "pdf-fallback",
      path: "/tmp/maket-print/Poster.pdf",
      reason: "the print dialog stopped Maket during the previous attempt",
    });

    expect(window.webContents.print).not.toHaveBeenCalled();
    expect(window.webContents.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      landscape: false,
      pageSize: { width: 210 / 25.4, height: 297 / 25.4 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    expect(host.openPdf).toHaveBeenCalledWith("Poster", expect.any(Uint8Array));
    expect(events).toEqual(["printToPDF"]);
  });

  it("falls back to a PDF on Linux when the native dialog fails", async () => {
    const { window, events } = fakeWindow({ print: (done) => done(false, "Invalid printer settings") });
    const host = fakeHost(window, { platform: "linux" });

    await expect(printWithNativeDialog(BASE, "Poster", host)).resolves.toMatchObject({
      status: "pdf-fallback",
      reason: "Invalid printer settings",
    });
    expect(events).toEqual(["show", "print-visible", "printToPDF"]);
    for (const task of host.deferred) task();
    expect(host.clearDialogPending).toHaveBeenCalledOnce();
  });

  it("does not fall back when the Linux user cancels the dialog", async () => {
    const { window } = fakeWindow({ print: (done) => done(false, "Print job canceled") });
    const host = fakeHost(window, { platform: "linux" });
    await expect(printWithNativeDialog(BASE, "Poster", host)).resolves.toEqual({ status: "canceled" });
    expect(window.webContents.printToPDF).not.toHaveBeenCalled();
  });

  it.each([
    { width: 148, height: 210, landscape: false, paper: { width: 148000, height: 210000 } },
    { width: 420, height: 297, landscape: true, paper: { width: 297000, height: 420000 } },
    { width: 100, height: 100, landscape: false, paper: { width: 100000, height: 100000 } },
  ])(
    "uses the document's $width × $height mm page in the native dialog",
    async ({ width, height, landscape, paper }) => {
      const { window } = fakeWindow({ size: { width, height }, print: (done) => done(false, "Print job canceled") });
      await printWithNativeDialog(BASE, "Format", fakeHost(window));
      expect(window.webContents.print).toHaveBeenCalledWith(
        expect.objectContaining({ landscape, pageSize: paper }),
        expect.any(Function),
      );
    },
  );

  it("keeps browser auto-printing out of the Electron URL", () => {
    expect(desktopPrintUrl(BASE, "Poster")).toContain("auto_print=false");
  });
});

describe("Linux print dialog availability", () => {
  const current = { app: "2.2.0", electron: "43.7.9" };
  const display = { DISPLAY: ":0" };

  it("uses the dialog on a normal desktop session", () => {
    expect(linuxDialogUnusableReason(display, null, current)).toBeNull();
    expect(linuxDialogUnusableReason({ WAYLAND_DISPLAY: "wayland-0" }, null, current)).toBeNull();
  });

  it("names the reasons the dialog cannot be used", () => {
    expect(linuxDialogUnusableReason({ ...display, MAKET_PRINT_FALLBACK: "pdf" }, null, current)).toBe(
      "MAKET_PRINT_FALLBACK=pdf",
    );
    expect(linuxDialogUnusableReason({}, null, current)).toBe("no graphical display");
    expect(linuxDialogUnusableReason(display, current, current)).toBe(
      "the print dialog stopped Maket during the previous attempt",
    );
  });

  it("tries the dialog again after Maket or Electron changes version", () => {
    expect(linuxDialogUnusableReason(display, { app: "2.2.0", electron: "43.4.1" }, current)).toBeNull();
  });
});
