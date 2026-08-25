import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATE_UPDATE_ROOT = "https://ng-galien.github.io/maket/updates/candidate";

interface CandidateFeedOptions {
  artifactsDir: string;
  outputDir: string;
  version: string;
  publishedAt?: Date;
}

export async function prepareCandidateUpdateFeed({
  artifactsDir,
  outputDir,
  version,
  publishedAt = new Date(),
}: CandidateFeedOptions): Promise<void> {
  if (!version.includes("-")) {
    throw new Error(`Candidate feed requires a prerelease version, received ${version}`);
  }

  const root = resolve(artifactsDir);
  const output = resolve(outputDir);
  const files = await listFiles(root);
  await rm(output, { recursive: true, force: true });

  await Promise.all([
    prepareMacFeed(files, output, version, publishedAt, "x64"),
    prepareMacFeed(files, output, version, publishedAt, "arm64"),
    prepareWindowsFeed(files, output),
  ]);
}

async function prepareMacFeed(
  files: string[],
  output: string,
  version: string,
  publishedAt: Date,
  arch: "x64" | "arm64",
): Promise<void> {
  const artifactRoot = `maket-app-macos-${arch}`;
  const zip = requireSingleArtifact(
    files,
    (path) => path.includes(artifactRoot) && path.endsWith(".zip"),
    `macOS ${arch} ZIP`,
  );
  const targetDir = join(output, "darwin", arch);
  const zipName = basename(zip);
  await mkdir(targetDir, { recursive: true });
  await copyFile(zip, join(targetDir, zipName));

  const updateUrl = new URL(`${CANDIDATE_UPDATE_ROOT}/darwin/${arch}/${encodeURIComponent(zipName)}`);
  const manifest = {
    currentRelease: version,
    releases: [
      {
        version,
        updateTo: {
          name: `Maket v${version}`,
          version,
          pub_date: publishedAt.toISOString(),
          url: updateUrl.toString(),
          notes: "",
        },
      },
    ],
  };
  await writeFile(join(targetDir, "RELEASES.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function prepareWindowsFeed(files: string[], output: string): Promise<void> {
  const artifactRoot = "maket-app-windows-x64";
  const windowsFiles = files.filter((path) => path.includes(artifactRoot));
  const releases = requireSingleArtifact(windowsFiles, (path) => basename(path) === "RELEASES", "Windows RELEASES");
  const packageFile = requireSingleArtifact(windowsFiles, (path) => path.endsWith("-full.nupkg"), "Windows full nupkg");
  const installer = preferCanonicalArtifact(
    windowsFiles,
    "Maket-Windows-x64-Setup.exe",
    (path) => path.endsWith(".exe"),
    "Windows installer",
  );
  const targetDir = join(output, "win32", "x64");
  await mkdir(targetDir, { recursive: true });
  await Promise.all(
    [releases, packageFile, installer].map((source) => copyFile(source, join(targetDir, basename(source)))),
  );
}

function preferCanonicalArtifact(
  files: string[],
  canonicalName: string,
  fallback: (path: string) => boolean,
  label: string,
): string {
  const canonical = files.filter((path) => basename(path) === canonicalName);
  if (canonical.length > 0) return requireSingleArtifact(canonical, () => true, `canonical ${label}`);
  return requireSingleArtifact(files, fallback, label);
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

function requireSingleArtifact(files: string[], matches: (path: string) => boolean, label: string): string {
  const found = files.filter(matches);
  if (found.length !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${found.length}`);
  }
  return found[0] as string;
}

async function main(): Promise<void> {
  const [artifactsDir, outputDir, version] = process.argv.slice(2);
  if (!artifactsDir || !outputDir || !version) {
    throw new Error("Usage: prepare-candidate-update-feed ARTIFACTS_DIR OUTPUT_DIR VERSION");
  }
  await prepareCandidateUpdateFeed({ artifactsDir, outputDir, version });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
