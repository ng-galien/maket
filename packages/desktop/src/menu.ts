import type { DesktopCommand, DesktopRuntimeState } from "@maket/shared";
import type { MenuItemConstructorOptions } from "electron";

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
        { label: "À propos de Maket", role: "about" },
        { type: "separator" },
        { label: `Workspace — ${state.workspace}`, enabled: false },
        { label: "Ouvrir le workspace Home", click: actions.openHome },
        { label: "Ouvrir un workspace…", accelerator: "CmdOrCtrl+O", click: actions.chooseWorkspace },
        { type: "separator" },
        { label: "Ouvrir dans le navigateur", click: actions.openInBrowser },
        { label: "Copier l’adresse du serveur", click: actions.copyServerUrl },
        { type: "separator" },
        { label: "Rechercher des mises à jour…", click: actions.checkForUpdates },
        { type: "separator" },
        { label: "Quitter Maket", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "Édition",
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
      label: "Bibliothèque",
      submenu: [
        command("Afficher ou masquer", "toggle-library", "CmdOrCtrl+Shift+B"),
        { type: "separator" },
        command("Documents", "show-documents", "CmdOrCtrl+1"),
        command("Chartes", "show-chartes", "CmdOrCtrl+2"),
        command("Photos", "show-photos", "CmdOrCtrl+3"),
        command("Collections", "show-collections", "CmdOrCtrl+4"),
        { type: "separator" },
        command("Échanges", "toggle-exchanges", "CmdOrCtrl+Shift+E"),
      ],
    },
    {
      label: "Document",
      submenu: [
        command("Vue lecture", "reading-view"),
        command("Recadrer", "fit-view"),
        command("Recadrage automatique", "toggle-auto-fit"),
        command("Verrouiller ou déverrouiller", "toggle-document-lock"),
        { type: "separator" },
        command("Imprimer…", "print-document", "CmdOrCtrl+P"),
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        command("Changer de thème", "toggle-theme"),
        command("Changer de langue", "toggle-language"),
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Fenêtre", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] },
    {
      label: "Aide",
      submenu: [command("Aide de Maket", "open-help")],
    },
  ];
}
