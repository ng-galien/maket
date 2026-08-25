import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareCandidateUpdateFeed } from "../../../scripts/prepare-candidate-update-feed.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("candidate update feed", () => {
  it("publishes updater metadata and artifacts for every supported target", async () => {
    const root = await mkdtemp(join(tmpdir(), "maket-candidate-feed-"));
    temporaryDirectories.push(root);
    const artifacts = join(root, "artifacts");
    const output = join(root, "output");
    await Promise.all([
      writeArtifact(artifacts, "maket-app-macos-x64", "Maket-darwin-x64-2.0.0-rc.1.zip", "x64"),
      writeArtifact(artifacts, "maket-app-macos-arm64", "Maket-darwin-arm64-2.0.0-rc.1.zip", "arm64"),
      writeArtifact(artifacts, "maket-app-windows-x64", "RELEASES", "release-index"),
      writeArtifact(artifacts, "maket-app-windows-x64", "maket_app-2.0.0-rc1-full.nupkg", "package"),
      writeArtifact(artifacts, "maket-app-windows-x64", "Maket-2.0.0-rc.1 Setup.exe", "installer"),
      writeArtifact(artifacts, "maket-app-windows-x64", "Maket-Windows-x64-Setup.exe", "canonical-installer"),
    ]);

    await prepareCandidateUpdateFeed({
      artifactsDir: artifacts,
      outputDir: output,
      version: "2.0.0-rc.1",
      publishedAt: new Date("2026-08-22T12:00:00.000Z"),
    });

    const armManifest = JSON.parse(await readFile(join(output, "darwin", "arm64", "RELEASES.json"), "utf8"));
    expect(armManifest).toMatchObject({
      currentRelease: "2.0.0-rc.1",
      releases: [
        {
          version: "2.0.0-rc.1",
          updateTo: {
            url: "https://ng-galien.github.io/maket/updates/candidate/darwin/arm64/Maket-darwin-arm64-2.0.0-rc.1.zip",
          },
        },
      ],
    });
    await expect(readFile(join(output, "darwin", "x64", "Maket-darwin-x64-2.0.0-rc.1.zip"), "utf8")).resolves.toBe(
      "x64",
    );
    await expect(readFile(join(output, "win32", "x64", "RELEASES"), "utf8")).resolves.toBe("release-index");
    await expect(readFile(join(output, "win32", "x64", "maket_app-2.0.0-rc1-full.nupkg"), "utf8")).resolves.toBe(
      "package",
    );
    await expect(readFile(join(output, "win32", "x64", "Maket-Windows-x64-Setup.exe"), "utf8")).resolves.toBe(
      "canonical-installer",
    );
  });

  it("rejects stable versions and incomplete artifact sets", async () => {
    const root = await mkdtemp(join(tmpdir(), "maket-candidate-feed-"));
    temporaryDirectories.push(root);
    const artifacts = join(root, "artifacts");
    await writeArtifact(artifacts, "maket-app-macos-x64", "Maket.zip", "zip");

    await expect(
      prepareCandidateUpdateFeed({
        artifactsDir: artifacts,
        outputDir: join(root, "output"),
        version: "2.0.0",
      }),
    ).rejects.toThrow("requires a prerelease version");
    await expect(
      prepareCandidateUpdateFeed({
        artifactsDir: artifacts,
        outputDir: join(root, "output"),
        version: "2.0.0-rc.1",
      }),
    ).rejects.toThrow("Expected exactly one macOS arm64 ZIP");
  });

  it("keeps the release workflow explicit about prerelease channels and Pages feeds", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/publish.yml"), "utf8");
    const pagesWorkflow = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/pages.yml"), "utf8");
    expect(workflow).toContain("npm publish --access public --tag next");
    expect(workflow).toContain("RELEASE_ARGS+=(--prerelease)");
    expect(workflow).toContain("candidate-feed:");
    expect(workflow).toContain("prepare-candidate-update-feed.ts");
    expect(pagesWorkflow).toContain("preserve-candidate-update-feed.ts");
  });

  it("rejects desktop packaging outside Node 22", () => {
    const desktop = resolve(import.meta.dirname, "../../../scripts/desktop.mjs");
    const versionFile = resolve(import.meta.dirname, "../../../.desktop-node-version");
    expect(readFileSync(versionFile, "utf8").trim()).toBe("22");
    const result = spawnSync(process.execPath, [desktop, "check"], {
      encoding: "utf8",
    });
    const runningNode22 = process.versions.node.startsWith("22.");
    expect(result.status).toBe(runningNode22 ? 0 : 1);
    if (!runningNode22) expect(result.stderr).toContain("requires Node 22");
  });

  it("keeps one desktop command for local and CI packaging", async () => {
    const rootPackage = JSON.parse(await readFile(resolve(import.meta.dirname, "../../../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const desktopPackage = JSON.parse(await readFile(resolve(import.meta.dirname, "../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/publish.yml"), "utf8");
    const desktopScript = await readFile(resolve(import.meta.dirname, "../../../scripts/desktop.mjs"), "utf8");
    const forgeConfig = await readFile(resolve(import.meta.dirname, "../forge.config.mjs"), "utf8");

    expect(Object.keys(rootPackage.scripts).filter((name) => name.startsWith("desktop"))).toEqual(["desktop"]);
    expect(Object.keys(desktopPackage.scripts).sort()).toEqual(["test", "typecheck"]);
    expect(workflow).toContain("npm run desktop -- make --arch=");
    expect(workflow).toContain("matrix.arch");
    expect(workflow).toContain("os: macos-15-intel");
    expect(workflow).not.toContain("desktop:make");
    expect(desktopScript).toContain("process.env.npm_execpath");
    expect(desktopScript).toContain('"@electron-forge", "cli", "dist", "electron-forge.js"');
    expect(desktopScript).not.toContain("npm.cmd");
    expect(desktopScript).not.toContain("electron-forge.cmd");
    expect(forgeConfig.match(/options: \{ bin: "Maket" }/g)).toHaveLength(2);
  });

  it("builds unsigned snapshots from main for every supported desktop target", async () => {
    const workflow = await readFile(
      resolve(import.meta.dirname, "../../../.github/workflows/desktop-snapshot.yml"),
      "utf8",
    );

    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain('MAKET_SIGN_DESKTOP: "0"');
    expect(workflow).toContain("--local-install");
    expect(workflow).toContain("retention-days: 14");
    expect(workflow).toContain("collect-desktop-installers.ts");
    expect(workflow.match(/platform: darwin/g)).toHaveLength(2);
    expect(workflow).toContain("platform: win32");
    expect(workflow).toContain("platform: linux");
  });

  it("publishes signed macOS and Windows installers plus Linux packages", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/publish.yml"), "utf8");
    const collector = await readFile(
      resolve(import.meta.dirname, "../../../scripts/collect-desktop-installers.ts"),
      "utf8",
    );

    const desktopBuild = workflow.indexOf("  desktop-build:");
    const desktopSteps = workflow.indexOf("    steps:", desktopBuild);
    const desktopJobHeader = workflow.slice(desktopBuild, desktopSteps);

    expect(workflow).toContain("Validate credentials and import macOS signing certificate");
    expect(workflow).toContain("Validate credentials and prepare Windows signing certificate");
    expect(workflow).toContain("MACOS_CERTIFICATE_PASSWORD");
    expect(workflow).toContain("WINDOWS_CERTIFICATE_PASSWORD");
    expect(desktopJobHeader).not.toContain("MACOS_CERTIFICATE");
    expect(desktopJobHeader).not.toContain("WINDOWS_CERTIFICATE");
    expect(desktopJobHeader).not.toContain("APPLE_ID");
    expect(workflow).toContain("platform: linux");
    expect(workflow).toContain("collect-desktop-installers.ts");
    expect(collector).toMatch(/SHA256SUMS-\$\{options\.platform}-\$\{options\.arch}\.txt/);
  });
});

async function writeArtifact(root: string, directory: string, name: string, content: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const target = join(root, directory);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, name), content);
}
