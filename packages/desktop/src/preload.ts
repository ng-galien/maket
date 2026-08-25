import {
  DESKTOP_API_VERSION,
  DESKTOP_CHANNELS,
  type DesktopApi,
  type DesktopCommand,
  type DesktopUpdateChannel,
  type DesktopUpdateState,
} from "@maket/shared";
import { contextBridge, ipcRenderer } from "electron";

const api: DesktopApi = {
  version: DESKTOP_API_VERSION,
  platform: process.platform as DesktopApi["platform"],
  runtime: {
    getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.runtimeState),
    openHome: () => ipcRenderer.invoke(DESKTOP_CHANNELS.runtimeOpenHome),
    chooseWorkspace: () => ipcRenderer.invoke(DESKTOP_CHANNELS.runtimeChooseWorkspace),
    openWorkspace: (path) => ipcRenderer.invoke(DESKTOP_CHANNELS.runtimeOpenWorkspace, path),
    openInBrowser: () => ipcRenderer.invoke(DESKTOP_CHANNELS.runtimeOpenBrowser),
    copyServerUrl: () => ipcRenderer.invoke(DESKTOP_CHANNELS.runtimeCopyUrl),
    printDocument: (name) => ipcRenderer.invoke(DESKTOP_CHANNELS.runtimePrintDocument, name),
  },
  commands: {
    onCommand(listener) {
      const handler = (_event: Electron.IpcRendererEvent, command: DesktopCommand) => listener(command);
      ipcRenderer.on(DESKTOP_CHANNELS.command, handler);
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.command, handler);
    },
  },
  mcp: {
    diagnose: () => ipcRenderer.invoke(DESKTOP_CHANNELS.mcpDiagnose),
    install: (client) => ipcRenderer.invoke(DESKTOP_CHANNELS.mcpInstall, client),
    uninstall: (client) => ipcRenderer.invoke(DESKTOP_CHANNELS.mcpUninstall, client),
  },
  configuration: {
    getPlan: () => ipcRenderer.invoke(DESKTOP_CHANNELS.configurationPlan),
    applyOnboarding: (selection) => ipcRenderer.invoke(DESKTOP_CHANNELS.configurationApplyOnboarding, selection),
    verifyOnboarding: () => ipcRenderer.invoke(DESKTOP_CHANNELS.configurationVerifyOnboarding),
    activateRuntime: () => ipcRenderer.invoke(DESKTOP_CHANNELS.configurationActivateRuntime),
    installClaudeDesktop: () => ipcRenderer.invoke(DESKTOP_CHANNELS.configurationInstallClaudeDesktop),
    acknowledgeRestarts: () => ipcRenderer.invoke(DESKTOP_CHANNELS.configurationAcknowledgeRestarts),
  },
  updates: {
    getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.updateState),
    getChannel: () => ipcRenderer.invoke(DESKTOP_CHANNELS.updateChannel),
    setChannel: (channel: DesktopUpdateChannel) => ipcRenderer.invoke(DESKTOP_CHANNELS.updateSetChannel, channel),
    check: () => ipcRenderer.invoke(DESKTOP_CHANNELS.updateCheck),
    install: () => ipcRenderer.invoke(DESKTOP_CHANNELS.updateInstall),
    onState(listener) {
      const handler = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => listener(state);
      ipcRenderer.on(DESKTOP_CHANNELS.updateStateChanged, handler);
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.updateStateChanged, handler);
    },
  },
};

contextBridge.exposeInMainWorld("maketDesktop", api);
