import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createElectronBrowserPool } from "./electron-browser-pool.js";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

function fixture(networkIdleMs = 0) {
  const debug = Object.assign(new EventEmitter(), {
    attached: false,
    attach: vi.fn(function (this: { attached: boolean }) {
      this.attached = true;
    }),
    detach: vi.fn(function (this: { attached: boolean }) {
      this.attached = false;
    }),
    isAttached: vi.fn(function (this: { attached: boolean }) {
      return this.attached;
    }),
    sendCommand: vi.fn(async (method: string) =>
      method === "Page.getFrameTree" ? { frameTree: { frame: { id: "frame-1" } } } : undefined,
    ),
  });
  const window = {
    webContents: {
      debugger: debug,
      session: { webRequest: { onBeforeRequest: vi.fn() } },
      executeJavaScript: vi.fn(),
      capturePage: vi.fn(),
      printToPDF: vi.fn(),
    },
    setContentSize: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
  };
  const pool = createElectronBrowserPool({
    createWindow: () => window as never,
    networkIdleMs,
  });
  return { pool, window, debug };
}

describe("Electron browser pool", () => {
  it("gives the window a renderer before attaching the debugger", async () => {
    const { pool, window, debug } = fixture();
    const browser = await pool.get();
    const page = await browser.newPage();

    expect(page.setNetworkGuard).toBeDefined();
    await page.setNetworkGuard?.("offline");

    expect(window.loadURL).toHaveBeenCalledWith("about:blank");
    const [navigated] = window.loadURL.mock.invocationCallOrder;
    const [attached] = debug.attach.mock.invocationCallOrder;
    expect(navigated).toBeDefined();
    expect(attached).toBeDefined();
    expect(navigated ?? 0).toBeLessThan(attached ?? 0);
    expect(debug.sendCommand).toHaveBeenCalledWith("Network.enable");
    expect(debug.sendCommand).toHaveBeenCalledWith("Page.enable");
    await pool.dispose();
  });

  it("installs document content through CDP so large renders are not capped by data: URLs", async () => {
    const { pool, window, debug } = fixture();
    const browser = await pool.get();
    const page = await browser.newPage();
    const html = `<html lang="en"><body><img alt="" src="data:image/png;base64,${"A".repeat(4_000_000)}"></body></html>`;

    await page.setContent(html);

    expect(window.loadURL).toHaveBeenCalledWith("about:blank");
    expect(window.loadURL).not.toHaveBeenCalledWith(expect.stringContaining("data:text/html"));
    expect(debug.sendCommand).toHaveBeenCalledWith("Page.setDocumentContent", {
      frameId: "frame-1",
      html,
    });
    await pool.dispose();
  });

  it("applies deviceScaleFactor through Chromium device metrics", async () => {
    const { pool, window, debug } = fixture();
    const browser = await pool.get();
    const page = await browser.newPage();

    await page.setViewport({ width: 420.2, height: 594.1, deviceScaleFactor: 2 });

    expect(window.setContentSize).toHaveBeenCalledWith(421, 595, false);
    expect(debug.sendCommand).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", {
      width: 421,
      height: 595,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await pool.dispose();
  });

  it("waits until tracked network requests finish and remain idle", async () => {
    const { pool, debug } = fixture(5);
    const browser = await pool.get();
    const page = await browser.newPage();
    await page.setContent("<p>ready</p>");
    debug.emit("message", {}, "Network.requestWillBeSent", { requestId: "request-1" });

    let settled = false;
    const waiting = page.waitForNetworkIdle().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(settled).toBe(false);

    debug.emit("message", {}, "Network.loadingFinished", { requestId: "request-1" });
    await waiting;
    expect(settled).toBe(true);
    await pool.dispose();
  });

  it("rejects a network-idle wait when the page closes", async () => {
    const { pool, debug } = fixture(5);
    const browser = await pool.get();
    const page = await browser.newPage();
    await page.setContent("<p>waiting</p>");
    debug.emit("message", {}, "Network.requestWillBeSent", { requestId: "request-1" });

    const waiting = page.waitForNetworkIdle();
    await page.close();

    await expect(waiting).rejects.toThrow("Electron render page was closed");
    await pool.dispose();
  });
});
