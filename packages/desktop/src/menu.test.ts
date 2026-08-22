import type { DesktopCommand, DesktopRuntimeState } from "@maket/shared";
import { describe, expect, it, vi } from "vitest";
import { buildApplicationMenuTemplate } from "./menu.js";

describe("native application menu", () => {
  it("exposes the shared V2 shell commands without duplicating renderer state", () => {
    const sent: DesktopCommand[] = [];
    const state: DesktopRuntimeState = {
      owner: "electron",
      workspace: "/tmp/maket-home",
      url: "http://127.0.0.1:24842",
      version: "2.0.0",
    };
    const template = buildApplicationMenuTemplate(state, {
      openHome: vi.fn(),
      chooseWorkspace: vi.fn(),
      openInBrowser: vi.fn(),
      copyServerUrl: vi.fn(),
      checkForUpdates: vi.fn(),
      sendCommand: (command) => sent.push(command),
    });
    expect(template.map((item) => item.label)).toEqual([
      "Maket",
      "Édition",
      "Bibliothèque",
      "Document",
      "Affichage",
      "Fenêtre",
      "Aide",
    ]);
    const library = template.find((item) => item.label === "Bibliothèque");
    const collections = Array.isArray(library?.submenu)
      ? library.submenu.find((item) => "label" in item && item.label === "Collections")
      : null;
    if (!collections || !("click" in collections) || !collections.click) {
      throw new Error("Collections native menu command is missing");
    }
    collections.click({} as never, {} as never, {} as never);
    expect(sent).toEqual(["show-collections"]);
  });
});
