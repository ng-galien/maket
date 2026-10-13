import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createElectronBrowserPool, type ElectronBrowserPoolOptions } from "./electron-browser-pool.js";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

function fixture(networkIdleMs = 0, options: Omit<ElectronBrowserPoolOptions, "createWindow" | "networkIdleMs"> = {}) {
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
    ...options,
  });
  return { pool, window, debug };
}

describe("Electron browser pool", () => {
  it("exposes print and screen media emulation through the render adapter", async () => {
    const { pool, debug } = fixture();
    const page = await (await pool.get()).newPage();

    expect(page.emulateMediaType).toBeDefined();
    await page.emulateMediaType?.("print");
    expect(debug.sendCommand).toHaveBeenCalledWith("Emulation.setEmulatedMedia", { media: "print" });
    await page.emulateMediaType?.("screen");
    expect(debug.sendCommand).toHaveBeenCalledWith("Emulation.setEmulatedMedia", { media: "screen" });
    await pool.dispose();
  });

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

  it("counts a request cancelled by the network guard as finished", async () => {
    const { pool, debug } = fixture(5, { networkIdleTimeoutMs: 1_000 });
    const page = await (await pool.get()).newPage();
    await page.setNetworkGuard?.("offline");
    await page.setContent("<img src='https://exfiltrate.example/leak.png'>");
    debug.emit("message", {}, "Network.requestWillBeSent", {
      requestId: "blocked-1",
      request: { url: "https://exfiltrate.example/leak.png" },
    });

    await expect(page.waitForNetworkIdle()).resolves.toBeUndefined();
    await pool.dispose();
  });

  it("still waits for a request the network guard allows", async () => {
    const { pool, debug } = fixture(5, { networkIdleTimeoutMs: 40 });
    const page = await (await pool.get()).newPage();
    await page.setNetworkGuard?.("offline");
    await page.setContent("<p>font</p>");
    debug.emit("message", {}, "Network.requestWillBeSent", {
      requestId: "font-1",
      request: { url: "https://fonts.googleapis.com/css2?family=Inter" },
    });

    await expect(page.waitForNetworkIdle()).rejects.toThrow('Render step "network idle" timed out after 40ms');
    await pool.dispose();
  });

  it("forgets requests of a replaced document", async () => {
    const { pool, debug } = fixture(5, { networkIdleTimeoutMs: 1_000 });
    const page = await (await pool.get()).newPage();
    await page.setContent("<p>first</p>");
    debug.emit("message", {}, "Network.requestWillBeSent", { requestId: "orphan-1" });
    await page.setContent("<p>second</p>");

    await expect(page.waitForNetworkIdle()).resolves.toBeUndefined();
    await pool.dispose();
  });

  it("rejects the network-idle wait at its deadline instead of spinning", async () => {
    const { pool, debug } = fixture(5, { networkIdleTimeoutMs: 30 });
    const page = await (await pool.get()).newPage();
    await page.setContent("<p>stuck</p>");
    debug.emit("message", {}, "Network.requestWillBeSent", { requestId: "never-finishes" });

    const started = Date.now();
    await expect(page.waitForNetworkIdle()).rejects.toThrow('Render step "network idle" timed out after 30ms');
    expect(Date.now() - started).toBeLessThan(1_000);
    await pool.dispose();
  });

  it("rejects an in-page wait whose frame never comes, and closes the window", async () => {
    const { pool, window } = fixture(0, { stepTimeoutMs: 30 });
    window.webContents.executeJavaScript.mockImplementation(() => new Promise(() => {}));
    const page = await (await pool.get()).newPage();

    await expect(
      page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"),
    ).rejects.toThrow('Render step "evaluate" timed out after 30ms');
    await page.close();
    expect(window.destroy).toHaveBeenCalledTimes(1);
    await pool.dispose();
  });

  it("bounds printing to PDF with a deadline", async () => {
    const { pool, window } = fixture(0, { stepTimeoutMs: 30 });
    window.webContents.printToPDF.mockImplementation(() => new Promise(() => {}));
    const page = await (await pool.get()).newPage();

    await expect(page.pdf({ width: "210mm", height: "297mm" })).rejects.toThrow(
      'Render step "print to PDF" timed out after 30ms',
    );
    await pool.dispose();
  });

  it("bounds a debugger command that never answers", async () => {
    const { pool, debug } = fixture(0, { stepTimeoutMs: 30 });
    debug.sendCommand.mockImplementation(async (method: string) => {
      if (method === "Network.enable") return new Promise<undefined>(() => {});
      return undefined;
    });
    const page = await (await pool.get()).newPage();

    await expect(page.setNetworkGuard?.("offline")).rejects.toThrow(
      'Render step "enable network events" timed out after 30ms',
    );
    await pool.dispose();
  });
});
