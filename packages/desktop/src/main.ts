import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type AgentClient, type AgentSetupService, createAgentSetupService } from "@maket/agent-setup";
import type {
  DesktopCommand,
  DesktopConfigurationPlan,
  DesktopOnboardingResult,
  DesktopRuntimeState,
  McpConfigurationFinding,
} from "@maket/shared";
import { DESKTOP_CHANNELS } from "@maket/shared";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type Event as ElectronEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  shell,
} from "electron";
import { inspectClaudeDesktop } from "./claude-desktop.js";
import { applyDesktopOnboarding, validateOnboardingSelection } from "./configuration-install.js";
import { createElectronBrowserPool } from "./electron-browser-pool.js";
import { buildApplicationMenuTemplate } from "./menu.js";
import { printWithNativeDialog } from "./native-print.js";
import { isTrustedIpcSender, isTrustedRendererUrl, shouldOpenInExternalBrowser } from "./renderer-security.js";
import { DesktopSetupPreferences } from "./setup-preferences.js";
import { handleSquirrelStartup } from "./squirrel-startup.js";
import { UpdateController } from "./update-controller.js";
import { installDesktopUpdate } from "./update-install.js";
import { UpdatePreferences } from "./update-preferences.js";
import { DESKTOP_SERVER_PORT, RuntimeOwnedError, WorkspaceController } from "./workspace-controller.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const developmentHostPath = join(process.resourcesPath, "development-host");
const developmentRoot = existsSync(developmentHostPath)
  ? readFileSync(developmentHostPath, "utf8").trim()
  : resolve(moduleDir, "../../..");
const preloadPath = join(moduleDir, "preload.cjs");
const applicationIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(developmentRoot, "packages", "desktop", "assets", "icon.png");
const bundledMaketSkillPath = join(process.resourcesPath, "maket", "SKILL.md");
const maketSkillPath =
  app.isPackaged && existsSync(bundledMaketSkillPath)
    ? bundledMaketSkillPath
    : join(developmentRoot, "plugin", "codex", "skills", "maket", "SKILL.md");
const isDevelopmentBuild = !app.isPackaged || existsSync(developmentHostPath);
const isLocalInstallBuild = app.isPackaged && existsSync(join(process.resourcesPath, "local-install"));
const desktopMcpEndpoint = `http://127.0.0.1:${DESKTOP_SERVER_PORT}/mcp`;

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
let runtimeReady = false;
let agentSetup: AgentSetupService | null = null;

const electronBrowserPool = createElectronBrowserPool();
const runtime = new WorkspaceController({
  version: app.getVersion(),
  packageDir: app.isPackaged ? process.resourcesPath : developmentRoot,
  port: DESKTOP_SERVER_PORT,
  browserPool: electronBrowserPool,
});
const updates = new UpdateController({
  enabled: !isDevelopmentBuild && !isLocalInstallBuild && process.platform !== "linux",
  disabledReason: isLocalInstallBuild ? "local-build" : "development-build",
  preferences: new UpdatePreferences(join(app.getPath("userData"), "desktop-preferences.json")),
});
const setupPreferences = new DesktopSetupPreferences(join(app.getPath("userData"), "desktop-setup.json"));

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
  await printWithNativeDialog(
    runtime.state().url,
    name,
    () =>
      new BrowserWindow({
        show: false,
        parent: mainWindow ?? undefined,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      }),
  );
}

function sendRendererCommand(command: DesktopCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(DESKTOP_CHANNELS.command, command);
}

function setupRendererUrl(): string {
  return pathToFileURL(join(app.isPackaged ? process.resourcesPath : developmentRoot, "public", "index.html")).href;
}

function trustedRendererUrls() {
  return {
    runtimeReady,
    runtimeUrl: runtimeReady ? runtime.state().url : desktopMcpEndpoint,
    setupUrl: setupRendererUrl(),
  };
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const window = mainWindow;
  const frame = event.senderFrame;
  const trusted =
    window &&
    !window.isDestroyed() &&
    isTrustedIpcSender({
      sender: event.sender,
      expectedSender: window.webContents,
      senderFrame: frame,
      mainFrame: event.sender.mainFrame,
      senderFrameUrl: frame?.url ?? "",
      ...trustedRendererUrls(),
    });
  if (!trusted) throw new Error("Desktop IPC is available only to the trusted Maket main frame");
}

function handleTrustedIpc<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return handler(...(args as TArgs));
  });
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
  handleTrustedIpc(DESKTOP_CHANNELS.runtimeState, (): DesktopRuntimeState => runtime.state());
  handleTrustedIpc(DESKTOP_CHANNELS.runtimeOpenHome, () => openWorkspace(runtime.home));
  handleTrustedIpc(DESKTOP_CHANNELS.runtimeChooseWorkspace, () => chooseWorkspace());
  handleTrustedIpc(DESKTOP_CHANNELS.runtimeOpenWorkspace, (path: unknown) => {
    if (typeof path !== "string" || path.length === 0) {
      throw new TypeError("Workspace path must be a non-empty string");
    }
    return openWorkspace(path);
  });
  handleTrustedIpc(DESKTOP_CHANNELS.runtimeOpenBrowser, () => openInBrowser());
  handleTrustedIpc(DESKTOP_CHANNELS.runtimeCopyUrl, () => {
    clipboard.writeText(runtime.state().url);
  });
  handleTrustedIpc(DESKTOP_CHANNELS.runtimePrintDocument, (name: unknown) => {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Document name must be a non-empty string");
    }
    return printDocument(name);
  });
  handleTrustedIpc(DESKTOP_CHANNELS.mcpDiagnose, (): McpConfigurationFinding[] => {
    if (!agentSetup) throw new Error("Agent setup is not initialized");
    return agentSetup.diagnose();
  });
  handleTrustedIpc(DESKTOP_CHANNELS.mcpInstall, (client: unknown): McpConfigurationFinding[] => {
    if (!agentSetup) throw new Error("Agent setup is not initialized");
    if (!isAgentClient(client)) throw new TypeError("Agent client must be claude, codex, or gemini");
    return agentSetup.install(client);
  });
  handleTrustedIpc(DESKTOP_CHANNELS.mcpUninstall, (client: unknown): McpConfigurationFinding[] => {
    if (!agentSetup) throw new Error("Agent setup is not initialized");
    if (!isAgentClient(client)) throw new TypeError("Agent client must be claude, codex, or gemini");
    return agentSetup.uninstall(client);
  });
  handleTrustedIpc(DESKTOP_CHANNELS.configurationPlan, (): DesktopConfigurationPlan => configurationPlan());
  handleTrustedIpc(
    DESKTOP_CHANNELS.configurationApplyOnboarding,
    async (value: unknown): Promise<DesktopOnboardingResult> => {
      if (!agentSetup) throw new Error("Agent setup is not initialized");
      const selection = validateOnboardingSelection(value);
      const owner = runtimeReady ? null : runtime.inspectOwner();
      if (owner?.owner === "electron") throw new RuntimeOwnedError(owner);
      if (owner && !selection.actions.includes("runtime")) {
        throw new Error("The embedded Maket server must be activated before setup can finish");
      }
      const execution = await applyDesktopOnboarding({
        selection,
        owner,
        services: {
          installAgent: (client) => agentSetup?.install(client),
          openClaudeDesktop: openClaudeDesktopBundle,
          takeControl: (target) => runtime.takeControl(target),
          startRuntime: activateEmbeddedRuntime,
          awaitClaudeDesktop: () => setupPreferences.awaitClaudeDesktop(),
          complete: () => setupPreferences.complete(),
          restartApplication,
        },
      });
      return { plan: configurationPlan(), results: execution.results };
    },
  );
  handleTrustedIpc(DESKTOP_CHANNELS.configurationVerifyOnboarding, (): DesktopConfigurationPlan => {
    const plan = configurationPlan();
    const claudeDesktop = plan.manualClients[0];
    if (setupPreferences.isAwaitingClaudeDesktop() && claudeDesktop?.status === "valid") {
      setupPreferences.complete();
      return configurationPlan();
    }
    return plan;
  });
  handleTrustedIpc(DESKTOP_CHANNELS.configurationActivateRuntime, () => activateEmbeddedRuntime());
  handleTrustedIpc(DESKTOP_CHANNELS.configurationInstallClaudeDesktop, async () => {
    await openClaudeDesktopBundle();
  });
  handleTrustedIpc(DESKTOP_CHANNELS.configurationAcknowledgeRestarts, () => {
    if (!agentSetup) throw new Error("Agent setup is not initialized");
    agentSetup.acknowledgeRestarts();
    return configurationPlan();
  });
  handleTrustedIpc(DESKTOP_CHANNELS.updateState, () => updates.getState());
  handleTrustedIpc(DESKTOP_CHANNELS.updateChannel, () => updates.getChannel());
  handleTrustedIpc(DESKTOP_CHANNELS.updateSetChannel, (channel: unknown) => {
    if (channel !== "stable" && channel !== "candidate") {
      throw new TypeError("Update channel must be stable or candidate");
    }
    return updates.setChannel(channel);
  });
  handleTrustedIpc(DESKTOP_CHANNELS.updateCheck, () => updates.check());
  handleTrustedIpc(DESKTOP_CHANNELS.updateInstall, async () => {
    await installDesktopUpdate({
      prepareInstall: () => updates.prepareInstall(),
      stopRuntime: async () => {
        if (runtimeStopped) return;
        await runtime.stop();
        runtimeStopped = true;
        runtimeReady = false;
      },
      startRuntime: async () => {
        await runtime.start();
        runtimeStopped = false;
        runtimeReady = true;
      },
      setQuitting: (value) => {
        quitting = value;
      },
    });
  });
}

function configurationPlan(): DesktopConfigurationPlan {
  if (!agentSetup) throw new Error("Agent setup is not initialized");
  const owner = runtimeReady ? null : runtime.inspectOwner();
  if (owner?.owner === "electron") throw new RuntimeOwnedError(owner);
  const claudeDesktopRoot = join(app.getPath("appData"), "Claude");
  const claudeDesktopApplication =
    process.platform === "darwin" &&
    (existsSync("/Applications/Claude.app") || existsSync(join(app.getPath("home"), "Applications", "Claude.app")));
  return {
    endpoint: desktopMcpEndpoint,
    onboardingRequired: setupPreferences.isRequired(),
    awaitingClaudeDesktop: setupPreferences.isAwaitingClaudeDesktop(),
    runtime: runtimeReady
      ? { status: "ready" }
      : {
          status: "action-required",
          owner: owner?.owner,
          host: owner?.host,
          port: owner?.port,
        },
    findings: agentSetup.diagnose(),
    manualClients: [
      inspectClaudeDesktop({
        applicationDetected: claudeDesktopApplication,
        bundlePath: claudeDesktopBundlePath(),
        bundledVersion: app.getVersion(),
        claudeRoot: claudeDesktopRoot,
      }),
    ],
    restartClients: agentSetup.pendingRestartClients(),
  };
}

async function openClaudeDesktopBundle(): Promise<void> {
  const error = await shell.openPath(claudeDesktopBundlePath());
  if (error) throw new Error(error);
}

function claudeDesktopBundlePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "maket-claude-desktop.mcpb")
    : join(developmentRoot, "packages", "desktop", "assets", "maket-claude-desktop.mcpb");
}

async function activateEmbeddedRuntime(): Promise<void> {
  if (runtimeReady) return;
  const owner = runtime.inspectOwner();
  if (owner) {
    if (owner.owner === "electron") throw new RuntimeOwnedError(owner);
    logStartup(`stopping ${owner.owner} server ${owner.pid} after explicit configuration action`);
    await runtime.takeControl(owner);
    restartApplication();
    return;
  }
  await runtime.start();
  runtimeReady = true;
  runtimeStopped = false;
  rebuildMenu();
  await mainWindow?.loadURL(runtime.state().url);
}

function restartApplication(): void {
  quitting = true;
  app.relaunch();
  app.exit(0);
}

function isAgentClient(value: unknown): value is AgentClient {
  return value === "claude" || value === "codex" || value === "gemini";
}

async function createWindow(url: string): Promise<void> {
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
    if (shouldOpenInExternalBrowser(url, runtimeReady ? runtime.state().url : null)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  const guardNavigation = (event: ElectronEvent, url: string) => {
    if (!isTrustedRendererUrl(url, trustedRendererUrls())) {
      event.preventDefault();
    }
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
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
  await window.loadURL(url);
}

async function bootstrap(): Promise<void> {
  logStartup("waiting for Electron readiness");
  await app.whenReady();
  installApplicationIcon();
  agentSetup = createAgentSetupService({
    homeDir: app.getPath("home"),
    statePath: join(app.getPath("userData"), "agent-setup.json"),
    endpoint: desktopMcpEndpoint,
    skillContent: readFileSync(maketSkillPath, "utf8"),
  });
  logStartup("Electron ready; preparing embedded server");
  try {
    registerIpc();
    const owner = runtime.inspectOwner();
    if (owner?.owner === "electron") {
      logStartup("another desktop runtime owns the workspace");
      app.quit();
      return;
    }
    let initialUrl: string;
    if (owner) {
      logStartup(`${owner.owner} server detected; waiting for explicit configuration action`);
      initialUrl = setupRendererUrl();
    } else {
      logStartup("starting embedded server");
      await runtime.start();
      runtimeReady = true;
      initialUrl = runtime.state().url;
      logStartup(`embedded server ready at ${initialUrl}`);
    }
    await createWindow(initialUrl);
    logStartup("main window created");
    if (runtimeReady) rebuildMenu();
    updates.start();
  } catch (error) {
    process.stderr.write(
      `[desktop] startup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    await dialog.showErrorBox("Maket could not start", error instanceof Error ? error.message : String(error));
    app.quit();
  }
}

if (
  handleSquirrelStartup({
    platform: process.platform,
    command: process.argv[1],
    execPath: process.execPath,
    quit: () => app.quit(),
  })
) {
  app.quit();
} else {
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
}
