/**
 * Main-process translations.
 *
 * The renderer's `useT` lives in React and cannot reach the native menu or the
 * Electron dialogs, so those strings are resolved here instead. The language is
 * the one persisted in the user settings file, which the main process already
 * reads for the update channel.
 */

import { unwatchFile, watchFile } from "node:fs";
import { readSettingsFile } from "@maket/server";
import type { SettingsLanguage } from "@maket/shared";

export type DesktopMessageKey = keyof typeof MESSAGES.en;

const MESSAGES = {
  en: {
    menu_about: "About Maket",
    menu_workspace: "Workspace — {workspace}",
    menu_open_home: "Open the Home workspace",
    menu_open_workspace: "Open a workspace…",
    menu_open_in_browser: "Open in browser",
    menu_copy_server_url: "Copy the server address",
    menu_check_updates: "Check for updates…",
    menu_quit: "Quit Maket",
    menu_edit: "Edit",
    menu_library: "Library",
    menu_toggle_library: "Show or hide",
    menu_documents: "Documents",
    menu_chartes: "Brand guides",
    menu_photos: "Photos",
    menu_collections: "Collections",
    menu_exchanges: "Exchanges",
    menu_document: "Document",
    menu_reading_view: "Reading view",
    menu_fit_view: "Fit to view",
    menu_auto_fit: "Automatic repositioning",
    menu_toggle_lock: "Lock or unlock",
    menu_print: "Print…",
    menu_view: "View",
    menu_toggle_theme: "Switch theme",
    menu_toggle_language: "Switch language",
    menu_window: "Window",
    menu_help: "Help",
    menu_help_maket: "Maket help",
    dialog_choose_workspace_title: "Open Maket Workspace",
    dialog_change_workspace: "Change workspace",
    dialog_cancel: "Cancel",
    dialog_change_workspace_message: "Change the active Maket workspace?",
    dialog_change_workspace_detail: "Browser and MCP clients will disconnect while the embedded server restarts.",
    dialog_renderer_gone_title: "Maket stopped unexpectedly",
    dialog_renderer_gone_detail: "The application window stopped responding and Maket will now quit.",
    dialog_start_failed_title: "Maket could not start",
  },
  fr: {
    menu_about: "À propos de Maket",
    menu_workspace: "Workspace — {workspace}",
    menu_open_home: "Ouvrir le workspace Home",
    menu_open_workspace: "Ouvrir un workspace…",
    menu_open_in_browser: "Ouvrir dans le navigateur",
    menu_copy_server_url: "Copier l’adresse du serveur",
    menu_check_updates: "Rechercher des mises à jour…",
    menu_quit: "Quitter Maket",
    menu_edit: "Édition",
    menu_library: "Bibliothèque",
    menu_toggle_library: "Afficher ou masquer",
    menu_documents: "Documents",
    menu_chartes: "Chartes",
    menu_photos: "Photos",
    menu_collections: "Collections",
    menu_exchanges: "Échanges",
    menu_document: "Document",
    menu_reading_view: "Vue lecture",
    menu_fit_view: "Recadrer",
    menu_auto_fit: "Recadrage automatique",
    menu_toggle_lock: "Verrouiller ou déverrouiller",
    menu_print: "Imprimer…",
    menu_view: "Affichage",
    menu_toggle_theme: "Changer de thème",
    menu_toggle_language: "Changer de langue",
    menu_window: "Fenêtre",
    menu_help: "Aide",
    menu_help_maket: "Aide de Maket",
    dialog_choose_workspace_title: "Ouvrir un workspace Maket",
    dialog_change_workspace: "Changer de workspace",
    dialog_cancel: "Annuler",
    dialog_change_workspace_message: "Changer le workspace Maket actif ?",
    dialog_change_workspace_detail:
      "Le navigateur et les clients MCP seront déconnectés pendant le redémarrage du serveur intégré.",
    dialog_renderer_gone_title: "Maket s’est arrêté de façon inattendue",
    dialog_renderer_gone_detail: "La fenêtre de l’application ne répond plus et Maket va se fermer.",
    dialog_start_failed_title: "Maket n’a pas pu démarrer",
  },
} satisfies Record<SettingsLanguage, Record<string, string>>;

export type DesktopTranslate = (key: DesktopMessageKey, params?: Record<string, string>) => string;

export function desktopMessage(
  language: SettingsLanguage,
  key: DesktopMessageKey,
  params?: Record<string, string>,
): string {
  const text = MESSAGES[language][key];
  if (!params) return text;
  return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, value), text);
}

/** Observe writes made by any Maket process to the global settings file. */
export function watchDesktopLanguage(
  settingsPath: string,
  onChange: (language: SettingsLanguage) => void,
  interval = 1_000,
): () => void {
  const listener = () => {
    onChange(readSettingsFile(settingsPath).language);
  };
  watchFile(settingsPath, { interval }, listener);
  listener();
  return () => unwatchFile(settingsPath, listener);
}
