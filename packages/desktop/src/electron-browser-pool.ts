import { randomUUID } from "node:crypto";
import type { BrowserPool, NetworkGuardMode, RenderBrowser, RenderPage } from "@maket/server";
import { isAllowedRenderRequest } from "@maket/server";
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

const DEFAULT_NETWORK_IDLE_MS = 100;

export interface ElectronBrowserPoolOptions {
  createWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  networkIdleMs?: number;
}

function mmToInches(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.endsWith("mm")) return undefined;
  const millimeters = Number.parseFloat(value.slice(0, -2));
  return Number.isFinite(millimeters) ? millimeters / 25.4 : undefined;
}

class ElectronRenderPage implements RenderPage {
  private readonly window: BrowserWindow;
  private viewport = { width: 800, height: 600 };
  private readonly inFlightRequests = new Set<string>();
  private debuggerReady: Promise<void> | null = null;
  private networkRevision = 0;
  private closed = false;

  constructor(private readonly options: ElectronBrowserPoolOptions) {
    this.window = (options.createWindow ?? ((windowOptions) => new BrowserWindow(windowOptions)))({
      width: this.viewport.width,
      height: this.viewport.height,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: `maket-render-${randomUUID()}`,
        sandbox: true,
      },
    });
  }

  private readonly onDebuggerMessage = (_event: unknown, method: string, params: Record<string, unknown>): void => {
    const requestId = typeof params.requestId === "string" ? params.requestId : null;
    if (!requestId) return;
    if (method === "Network.requestWillBeSent") {
      this.inFlightRequests.add(requestId);
      this.networkRevision += 1;
      return;
    }
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      this.inFlightRequests.delete(requestId);
      this.networkRevision += 1;
    }
  };

  private ensureDebugger(): Promise<void> {
    if (!this.debuggerReady) {
      this.debuggerReady = (async () => {
        // Chromium only services debugger commands once the window owns a
        // renderer. On a BrowserWindow that never navigated, `Network.enable`
        // never resolves and wedges the whole render, so navigate first.
        await this.window.loadURL("about:blank");
        const debug = this.window.webContents.debugger;
        if (!debug.isAttached()) debug.attach();
        debug.on("message", this.onDebuggerMessage);
        await debug.sendCommand("Network.enable");
        await debug.sendCommand("Page.enable");
      })();
    }
    return this.debuggerReady;
  }

  async setNetworkGuard(mode: NetworkGuardMode): Promise<void> {
    await this.ensureDebugger();
    this.window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isAllowedRenderRequest(details.url, mode) });
    });
  }

  async setViewport(viewport: { width: number; height: number; deviceScaleFactor?: number }): Promise<void> {
    await this.ensureDebugger();
    this.viewport = {
      width: Math.max(1, Math.ceil(viewport.width)),
      height: Math.max(1, Math.ceil(viewport.height)),
    };
    this.window.setContentSize(this.viewport.width, this.viewport.height, false);
    await this.window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: this.viewport.width,
      height: this.viewport.height,
      deviceScaleFactor: Math.max(0.1, viewport.deviceScaleFactor ?? 1),
      mobile: false,
    });
  }

  // A `data:` URL cannot carry a rendered document: Chromium caps URLs at 2 MB
  // and a single inlined print-quality image already exceeds that. CDP replaces
  // the document in place, with no size limit, exactly like puppeteer's
  // `setContent` does on the headless path.
  async setContent(html: string): Promise<void> {
    await this.ensureDebugger();
    const debug = this.window.webContents.debugger;
    await this.window.loadURL("about:blank");
    const { frameTree } = (await debug.sendCommand("Page.getFrameTree")) as {
      frameTree: { frame: { id: string } };
    };
    await debug.sendCommand("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html,
    });
  }

  async waitForNetworkIdle(): Promise<void> {
    await this.ensureDebugger();
    const idleMs = Math.max(0, this.options.networkIdleMs ?? DEFAULT_NETWORK_IDLE_MS);
    for (;;) {
      this.assertOpen();
      while (this.inFlightRequests.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.assertOpen();
      }
      const revision = this.networkRevision;
      await new Promise((resolve) => setTimeout(resolve, idleMs));
      this.assertOpen();
      if (this.inFlightRequests.size === 0 && revision === this.networkRevision) return;
    }
  }

  private assertOpen(): void {
    if (this.closed || this.window.isDestroyed()) {
      throw new Error("Electron render page was closed");
    }
  }

  async evaluate<T>(pageFunction: ((...args: never[]) => T) | string, ...args: unknown[]): Promise<Awaited<T>> {
    const source =
      typeof pageFunction === "string" ? pageFunction : `(${pageFunction.toString()})(...${JSON.stringify(args)})`;
    return this.window.webContents.executeJavaScript(source) as Promise<Awaited<T>>;
  }

  async screenshot(options: Record<string, unknown> = {}): Promise<Uint8Array> {
    const clip = options.clip as { x: number; y: number; width: number; height: number } | undefined;
    const image = await this.window.webContents.capturePage(clip, {
      stayHidden: true,
    });
    return image.toPNG();
  }

  async pdf(options: Record<string, unknown> = {}): Promise<Uint8Array> {
    const width = mmToInches(options.width);
    const height = mmToInches(options.height);
    return this.window.webContents.printToPDF({
      pageSize: width && height ? { width, height } : undefined,
      preferCSSPageSize: true,
      printBackground: options.printBackground !== false,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.window.isDestroyed()) return;
    try {
      if (this.debuggerReady) {
        const debug = this.window.webContents.debugger;
        debug.removeListener("message", this.onDebuggerMessage);
        if (debug.isAttached()) debug.detach();
      }
    } finally {
      this.window.destroy();
    }
  }
}

class ElectronRenderBrowser implements RenderBrowser {
  connected = true;
  private readonly pages = new Set<ElectronRenderPage>();
  private readonly disconnected = new Set<() => void>();

  constructor(private readonly options: ElectronBrowserPoolOptions) {}

  async newPage(): Promise<RenderPage> {
    const page = new ElectronRenderPage(this.options);
    this.pages.add(page);
    return {
      setNetworkGuard: (mode) => page.setNetworkGuard(mode),
      setViewport: (viewport) => page.setViewport(viewport),
      setContent: (html) => page.setContent(html),
      waitForNetworkIdle: () => page.waitForNetworkIdle(),
      evaluate: (pageFunction, ...args) => page.evaluate(pageFunction, ...args),
      screenshot: (options) => page.screenshot(options),
      pdf: (options) => page.pdf(options),
      close: async () => {
        this.pages.delete(page);
        await page.close();
      },
    };
  }

  on(event: "disconnected", listener: () => void): void {
    if (event === "disconnected") this.disconnected.add(listener);
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await Promise.all([...this.pages].map((page) => page.close()));
    this.pages.clear();
    for (const listener of this.disconnected) listener();
  }
}

export function createElectronBrowserPool(options: ElectronBrowserPoolOptions = {}): BrowserPool {
  const browser = new ElectronRenderBrowser(options);
  return {
    async get() {
      if (!browser.connected) throw new Error("Electron render browser is closed");
      return browser;
    },
    async dispose() {
      await browser.close();
    },
  };
}
