import {
  DESKTOP_API_VERSION,
  DESKTOP_CHANNELS,
  type DesktopApi,
  type DesktopCommand,
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
  },
  updates: {
    getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.updateState),
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
