import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectDesktopInstallers } from "../../../scripts/collect-desktop-installers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("desktop distributable collection", () => {
  it.each([
    {
      platform: "darwin" as const,
      arch: "arm64",
      sources: ["Maket-2.0.0-arm64.dmg", "Maket-darwin-arm64-2.0.0.zip"],
      canonical: ["Maket-macOS-arm64.dmg"],
    },
    {
      platform: "win32" as const,
      arch: "x64",
      sources: ["MaketAppSetup.exe", "RELEASES", "maket_app-2.0.0-full.nupkg"],
      canonical: ["Maket-Windows-x64-Setup.exe"],
    },
    {
      platform: "linux" as const,
      arch: "x64",
      sources: ["maket-app_2.0.0_amd64.deb", "maket-app-2.0.0.x86_64.rpm"],
      canonical: ["Maket-Linux-x64.deb", "Maket-Linux-x64.rpm"],
    },
  ])(
    "keeps updater assets and adds stable $platform download names",
    async ({ platform, arch, sources, canonical }) => {
      const root = await mkdtemp(join(tmpdir(), "maket-desktop-artifacts-"));
      temporaryDirectories.push(root);
      const sourceDir = join(root, "make", "nested");
      const outputDir = join(root, "collected");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(sourceDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(outputDir, "stale-installer.exe"), "stale");
      await Promise.all(sources.map((name) => writeFile(join(sourceDir, name), name)));

      await collectDesktopInstallers({ sourceDir: join(root, "make"), outputDir, platform, arch });

      for (const name of [...sources, ...canonical]) {
        await expect(readFile(join(outputDir, name), "utf8")).resolves.toBeTruthy();
      }
      const manifest = JSON.parse(await readFile(join(outputDir, `manifest-${platform}-${arch}.json`), "utf8"));
      expect(manifest).toMatchObject({ platform, arch });
      expect(manifest.artifacts.map(({ name }: { name: string }) => name)).toEqual(
        expect.arrayContaining([...sources, ...canonical]),
      );
      const checksums = await readFile(join(outputDir, `SHA256SUMS-${platform}-${arch}.txt`), "utf8");
      for (const name of [...sources, ...canonical]) expect(checksums).toContain(`  ${name}`);
      await expect(readFile(join(outputDir, "stale-installer.exe"))).rejects.toThrow();
    },
  );

  it("rejects an incomplete installer set", async () => {
    const root = await mkdtemp(join(tmpdir(), "maket-desktop-artifacts-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "Maket.dmg"), "dmg");

    await expect(
      collectDesktopInstallers({ sourceDir: root, outputDir: join(root, "out"), platform: "darwin", arch: "x64" }),
    ).rejects.toThrow("macOS x64 ZIP updater");
  });
});
