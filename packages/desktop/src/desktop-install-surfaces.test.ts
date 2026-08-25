import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const canonicalDownloads = [
  "Maket-macOS-arm64.dmg",
  "Maket-macOS-x64.dmg",
  "Maket-Windows-x64-Setup.exe",
  "Maket-Linux-x64.deb",
  "Maket-Linux-x64.rpm",
];

describe("desktop installation surfaces", () => {
  it("starts the README with Maket App and keeps the server path secondary", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");

    expect(readme.indexOf("## Install Maket App")).toBeGreaterThan(-1);
    expect(readme.indexOf("## Install Maket App")).toBeLessThan(readme.indexOf("## Why Maket"));
    expect(readme).toContain("Maket Server via npm (advanced)");
    expect(readme).toContain("actions/workflows/desktop-snapshot.yml");
    expectCanonicalNames(readme);
    expect(readme).not.toContain("releases/latest/download/");
  });

  it.each(["docs/index.html", "docs/fr/index.html"])(
    "offers an OS-aware primary download and every installer on %s",
    async (relativePath) => {
      const page = await readFile(resolve(repositoryRoot, relativePath), "utf8");

      expect(page).toContain("data-platform-download");
      expect(page).toContain("data-windows-url=");
      expect(page).toContain("data-macos-url=");
      expect(page).toContain("data-linux-url=");
      expect(page).toContain("navigator.userAgentData?.platform");
      expect(page).toContain("api.github.com/repos/ng-galien/maket/releases/latest");
      expect(page).toContain("asset.browser_download_url");
      expect(page).toContain("actions/workflows/desktop-snapshot.yml");
      expectCanonicalNames(page);
      expect(page).not.toContain('href="https://github.com/ng-galien/maket/releases/latest/download/');
      const platformAttribute = page.indexOf("data-platform-download");
      const primaryDownload = page.slice(
        page.lastIndexOf("<a", platformAttribute),
        page.indexOf("</a>", platformAttribute),
      );
      expect(primaryDownload).toContain(
        'href="https://github.com/ng-galien/maket/actions/workflows/desktop-snapshot.yml"',
      );
      expect(primaryDownload.toLowerCase()).toContain("snapshot");
      expect(page.indexOf("!downloads.every")).toBeLessThan(
        page.indexOf("for (const link of document.querySelectorAll('[data-release-asset]'))"),
      );
    },
  );
});

function expectCanonicalNames(contents: string): void {
  for (const name of canonicalDownloads) {
    expect(contents).toContain(name);
  }
}
