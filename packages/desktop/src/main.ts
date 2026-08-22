import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopCommand, DesktopRuntimeState, McpConfigurationFinding } from "@maket/shared";
import { DESKTOP_CHANNELS } from "@maket/shared";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { buildApplicationMenuTemplate } from "./menu.js";
import { UpdateController } from "./update-controller.js";
import { RuntimeOwnedError, WorkspaceController } from "./workspace-controller.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const developmentRoot = resolve(moduleDir, "../../..");
const preloadPath = join(moduleDir, "preload.cjs");
const applicationIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(developmentRoot, "packages", "desktop", "assets", "icon.png");
const isDevelopmentBuild = !app.isPackaged || existsSync(join(process.resourcesPath, "development-host"));

app.setName("Maket");
app.setAboutPanelOptions({
  applicationName: "Maket",
  applicationVersion: app.getVersion(),
  copyright: "Copyright © 2026 Alexandre Boyer",
  version: app.getVersion(),
  website: "https://github.com/ng-galien/maket",
});

let mainWindow: BrowserWindow | null = null;
let quitting = false;
let runtimeStopped = false;

const runtime = new WorkspaceController({
  version: app.getVersion(),
  packageDir: app.isPackaged ? process.resourcesPath : developmentRoot,
});
const updates = new UpdateController(!isDevelopmentBuild);

function logStartup(message: string): void {
  process.stderr.write(`[desktop] ${message}\n`);
}

async function logRendererDiagnostics(window: BrowserWindow, stage: "load" | "hydrated" | "settled"): Promise<void> {
  if (!isDevelopmentBuild || window.isDestroyed()) return;
  try {
    const metrics = await window.webContents.executeJavaScript(`(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        responseEndMs: navigation ? Math.round(navigation.responseEnd) : null,
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
        loadMs: navigation ? Math.round(navigation.loadEventEnd) : null,
        domNodes: document.getElementsByTagName("*").length,
        documents: document.querySelectorAll("[data-doc]").length,
        pages: document.querySelectorAll(".page-canvas").length,
        images: document.images.length,
      };
    })()`);
    logStartup(`renderer diagnostics (${stage}) ${JSON.stringify(metrics)}`);
  } catch (error) {
    logStartup(`renderer diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function installApplicationIcon(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  try {
    app.dock.setIcon(applicationIconPath);
    logStartup(`application icon loaded from ${applicationIconPath}`);
  } catch (error) {
    logStartup(`application icon could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function openWorkspace(path: string): Promise<void> {
  const current = runtime.state();
  if (resolve(path) === current.workspace) return;
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    buttons: ["Change workspace", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Change the active Maket workspace?",
    detail: "Browser and MCP clients will disconnect while the embedded server restarts.",
  };
  const choice = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
  if (choice.response !== 0) return;
  await runtime.switchTo(path);
  await mainWindow?.loadURL(runtime.state().url);
  rebuildMenu();
}

async function chooseWorkspace(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
    title: "Open Maket Workspace",
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function chooseAndOpenWorkspace(): Promise<void> {
  const path = await chooseWorkspace();
  if (path) await openWorkspace(path);
}

async function openInBrowser(): Promise<void> {
  await shell.openExternal(runtime.state().url);
}

async function printDocument(name: string): Promise<void> {
  const url = new URL("/print", runtime.state().url);
  url.searchParams.set("name", name);
  await shell.openExternal(url.toString());
}

function sendRendererCommand(command: DesktopCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(DESKTOP_CHANNELS.command, command);
}

function rebuildMenu(): void {
  const state = runtime.state();
  const template = buildApplicationMenuTemplate(state, {
    openHome: () => void openWorkspace(runtime.home),
    chooseWorkspace: () => void chooseAndOpenWorkspace(),
    openInBrowser: () => void openInBrowser(),
    copyServerUrl: () => clipboard.writeText(state.url),
    checkForUpdates: () => void updates.check(),
    sendCommand: sendRendererCommand,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle(DESKTOP_CHANNELS.runtimeState, (): DesktopRuntimeState => runtime.state());
  ipcMain.handle(DESKTOP_CHANNELS.runtimeOpenHome, () => openWorkspace(runtime.home));
  ipcMain.handle(DESKTOP_CHANNELS.runtimeChooseWorkspace, () => chooseWorkspace());
  ipcMain.handle(DESKTOP_CHANNELS.runtimeOpenWorkspace, (_event, path: unknown) => {
    if (typeof path !== "string" || path.length === 0) {
      throw new TypeError("Workspace path must be a non-empty string");
    }
    return openWorkspace(path);
  });
  ipcMain.handle(DESKTOP_CHANNELS.runtimeOpenBrowser, () => openInBrowser());
  ipcMain.handle(DESKTOP_CHANNELS.runtimeCopyUrl, () => {
    clipboard.writeText(runtime.state().url);
  });
  ipcMain.handle(DESKTOP_CHANNELS.runtimePrintDocument, (_event, name: unknown) => {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Document name must be a non-empty string");
    }
    return printDocument(name);
  });
  ipcMain.handle(DESKTOP_CHANNELS.mcpDiagnose, (): McpConfigurationFinding[] => []);
  ipcMain.handle(DESKTOP_CHANNELS.updateState, () => updates.getState());
  ipcMain.handle(DESKTOP_CHANNELS.updateCheck, () => updates.check());
  ipcMain.handle(DESKTOP_CHANNELS.updateInstall, () => updates.install());
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#111111",
    icon: applicationIconPath,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  updates.attach(window);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith(runtime.state().url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(runtime.state().url)) event.preventDefault();
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (quitting || details.reason === "clean-exit") return;
    logStartup(`renderer stopped unexpectedly: ${details.reason} (${details.exitCode})`);
    dialog.showErrorBox(
      "Maket stopped unexpectedly",
      "The application window stopped responding and Maket will now quit.",
    );
    app.quit();
  });
  window.webContents.on("did-finish-load", () => {
    void logRendererDiagnostics(window, "load");
    setTimeout(() => void logRendererDiagnostics(window, "hydrated"), 1500);
    setTimeout(() => void logRendererDiagnostics(window, "settled"), 5000);
  });
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  await window.loadURL(runtime.state().url);
}

async function startRuntime(): Promise<boolean> {
  for (;;) {
    try {
      await runtime.start();
      return true;
    } catch (error) {
      if (!(error instanceof RuntimeOwnedError)) throw error;
      const isDesktop = error.descriptor.owner === "electron";
      const result = await dialog.showMessageBox({
        type: "warning",
        buttons: isDesktop ? ["Quit"] : ["Take Control", "Quit"],
        defaultId: isDesktop ? 0 : 1,
        cancelId: isDesktop ? 0 : 1,
        message: isDesktop ? "Maket is already open." : "A Maket server is already running.",
        detail: isDesktop
          ? "Only one Maket desktop instance can use the Home workspace."
          : `The server using ${error.descriptor.dataDir} must stop before the desktop application can use this workspace. Take control now?`,
      });
      if (isDesktop || result.response !== 0) return false;
      await runtime.takeControl(error.descriptor);
    }
  }
}

async function bootstrap(): Promise<void> {
  logStartup("waiting for Electron readiness");
  await app.whenReady();
  installApplicationIcon();
  logStartup("Electron ready; starting embedded server");
  try {
    if (!(await startRuntime())) {
      logStartup("startup cancelled by user");
      app.quit();
      return;
    }
    logStartup(`embedded server ready at ${runtime.state().url}`);
    registerIpc();
    await createWindow();
    logStartup("main window created");
    rebuildMenu();
    updates.start();
  } catch (error) {
    process.stderr.write(
      `[desktop] startup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    await dialog.showErrorBox("Maket could not start", error instanceof Error ? error.message : String(error));
    app.quit();
  }
}

const hasLock = app.requestSingleInstanceLock();
logStartup(`single-instance lock: ${hasLock ? "acquired" : "already owned"}`);
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    quitting = true;
    if (runtimeStopped) return;
    event.preventDefault();
    void runtime.stop().finally(() => {
      runtimeStopped = true;
      app.quit();
    });
  });
  void bootstrap();
}
