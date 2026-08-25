import type { DesktopCommand, DesktopRuntimeState } from "@maket/shared";
import type { MenuItemConstructorOptions } from "electron";
import type { DesktopTranslate } from "./i18n.js";

export interface ApplicationMenuActions {
  openHome: () => void;
  chooseWorkspace: () => void;
  openInBrowser: () => void;
  copyServerUrl: () => void;
  checkForUpdates: () => void;
  sendCommand: (command: DesktopCommand) => void;
}

// The native menu is declarative composition over injected lifecycle actions.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function buildApplicationMenuTemplate(
  state: DesktopRuntimeState,
  actions: ApplicationMenuActions,
  t: DesktopTranslate,
): MenuItemConstructorOptions[] {
  const command = (label: string, value: DesktopCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => actions.sendCommand(value),
  });
  return [
    {
      label: "Maket",
      submenu: [
        { label: t("menu_about"), role: "about" },
        { type: "separator" },
        { label: t("menu_workspace", { workspace: state.workspace }), enabled: false },
        { label: t("menu_open_home"), click: actions.openHome },
        { label: t("menu_open_workspace"), accelerator: "CmdOrCtrl+O", click: actions.chooseWorkspace },
        { type: "separator" },
        { label: t("menu_open_in_browser"), click: actions.openInBrowser },
        { label: t("menu_copy_server_url"), click: actions.copyServerUrl },
        { type: "separator" },
        { label: t("menu_check_updates"), click: actions.checkForUpdates },
        { type: "separator" },
        { label: t("menu_quit"), accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: t("menu_edit"),
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: t("menu_library"),
      submenu: [
        command(t("menu_toggle_library"), "toggle-library", "CmdOrCtrl+Shift+B"),
        { type: "separator" },
        command(t("menu_documents"), "show-documents", "CmdOrCtrl+1"),
        command(t("menu_chartes"), "show-chartes", "CmdOrCtrl+2"),
        command(t("menu_photos"), "show-photos", "CmdOrCtrl+3"),
        command(t("menu_collections"), "show-collections", "CmdOrCtrl+4"),
        { type: "separator" },
        command(t("menu_exchanges"), "toggle-exchanges", "CmdOrCtrl+Shift+E"),
      ],
    },
    {
      label: t("menu_document"),
      submenu: [
        command(t("menu_reading_view"), "reading-view"),
        command(t("menu_fit_view"), "fit-view"),
        command(t("menu_auto_fit"), "toggle-auto-fit"),
        command(t("menu_toggle_lock"), "toggle-document-lock"),
        { type: "separator" },
        command(t("menu_print"), "print-document", "CmdOrCtrl+P"),
      ],
    },
    {
      label: t("menu_view"),
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        command(t("menu_toggle_theme"), "toggle-theme"),
        command(t("menu_toggle_language"), "toggle-language"),
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: t("menu_window"), submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] },
    {
      label: t("menu_help"),
      submenu: [command(t("menu_help_maket"), "open-help")],
    },
  ];
}
