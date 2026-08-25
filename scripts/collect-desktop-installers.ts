import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DesktopPlatform = "darwin" | "win32" | "linux";

export interface CollectDesktopInstallersOptions {
  sourceDir: string;
  outputDir: string;
  platform: DesktopPlatform;
  arch: string;
}

interface ArtifactEntry {
  name: string;
  bytes: number;
  sha256: string;
}

/** Flatten Forge output, retain updater assets, and add stable human-download names. */
export async function collectDesktopInstallers(options: CollectDesktopInstallersOptions): Promise<ArtifactEntry[]> {
  const sourceDir = resolve(options.sourceDir);
  const outputDir = resolve(options.outputDir);
  const sources = await filesBelow(sourceDir);
  if (sources.length === 0) throw new Error(`No desktop distributables found in ${sourceDir}`);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const copied = new Map<string, string>();
  for (const source of sources) {
    const name = basename(source);
    const existing = copied.get(name);
    if (existing) {
      if ((await readFile(existing)).equals(await readFile(source))) continue;
      throw new Error(`Desktop distributables contain conflicting files named ${name}`);
    }
    const target = join(outputDir, name);
    await cp(source, target);
    copied.set(name, source);
  }

  for (const [canonicalName, source] of canonicalInstallers(options.platform, options.arch, sources)) {
    await cp(source, join(outputDir, canonicalName));
  }

  const artifacts = await artifactEntries(outputDir);
  const manifestName = `manifest-${options.platform}-${options.arch}.json`;
  await writeFile(
    join(outputDir, manifestName),
    `${JSON.stringify({ platform: options.platform, arch: options.arch, artifacts }, null, 2)}\n`,
  );
  await writeFile(
    join(outputDir, `SHA256SUMS-${options.platform}-${options.arch}.txt`),
    `${artifacts.map(({ name, sha256 }) => `${sha256}  ${name}`).join("\n")}\n`,
  );
  return artifacts;
}

function canonicalInstallers(platform: DesktopPlatform, arch: string, sources: string[]): Array<[string, string]> {
  if (platform === "darwin") {
    requireOne(sources, (path) => extname(path).toLowerCase() === ".zip", `macOS ${arch} ZIP updater`);
    return [
      [
        `Maket-macOS-${arch}.dmg`,
        requireOne(sources, (path) => extname(path).toLowerCase() === ".dmg", `macOS ${arch} DMG`),
      ],
    ];
  }
  if (platform === "win32") {
    requireOne(sources, (path) => basename(path) === "RELEASES", "Windows RELEASES index");
    requireOne(sources, (path) => /-full\.nupkg$/i.test(path), "Windows full Squirrel package");
    return [
      [
        `Maket-Windows-${arch}-Setup.exe`,
        requireOne(sources, (path) => /setup\.exe$/i.test(path), `Windows ${arch} installer`),
      ],
    ];
  }
  return [
    [
      `Maket-Linux-${arch}.deb`,
      requireOne(sources, (path) => extname(path).toLowerCase() === ".deb", `Linux ${arch} DEB`),
    ],
    [
      `Maket-Linux-${arch}.rpm`,
      requireOne(sources, (path) => extname(path).toLowerCase() === ".rpm", `Linux ${arch} RPM`),
    ],
  ];
}

function requireOne(sources: string[], predicate: (path: string) => boolean, label: string): string {
  const matches = sources.filter(predicate);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}; found ${matches.length}`);
  return matches[0] as string;
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : Promise.resolve(entry.isFile() ? [path] : []);
    }),
  );
  return nested.flat().sort();
}

async function artifactEntries(outputDir: string): Promise<ArtifactEntry[]> {
  const names = (await readdir(outputDir)).sort();
  return Promise.all(
    names.map(async (name) => {
      const path = join(outputDir, name);
      const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
      return {
        name,
        bytes: metadata.size,
        sha256: createHash("sha256").update(contents).digest("hex"),
      };
    }),
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [sourceDir, outputDir, platform, arch] = process.argv.slice(2);
  if (!sourceDir || !outputDir || !platform || !arch || !["darwin", "win32", "linux"].includes(platform)) {
    throw new Error("Usage: collect-desktop-installers SOURCE_DIR OUTPUT_DIR <darwin|win32|linux> ARCH");
  }
  await collectDesktopInstallers({
    sourceDir,
    outputDir,
    platform: platform as DesktopPlatform,
    arch,
  });
}
