import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATE_UPDATE_ROOT = "https://ng-galien.github.io/maket/updates/candidate";

interface PreserveCandidateFeedOptions {
  outputDir: string;
  fetchImpl?: typeof fetch;
}

export async function preserveCandidateUpdateFeed({
  outputDir,
  fetchImpl = fetch,
}: PreserveCandidateFeedOptions): Promise<void> {
  await Promise.all([
    preserveMacFeed("x64", outputDir, fetchImpl),
    preserveMacFeed("arm64", outputDir, fetchImpl),
    preserveWindowsFeed(outputDir, fetchImpl),
  ]);
}

async function preserveMacFeed(arch: "x64" | "arm64", outputDir: string, fetchImpl: typeof fetch): Promise<void> {
  const baseUrl = `${CANDIDATE_UPDATE_ROOT}/darwin/${arch}`;
  const manifestResponse = await fetchImpl(`${baseUrl}/RELEASES.json`);
  if (manifestResponse.status === 404) return;
  if (!manifestResponse.ok) throw new Error(`Candidate macOS ${arch} feed returned ${manifestResponse.status}`);
  const manifestText = await manifestResponse.text();
  const manifest = JSON.parse(manifestText) as {
    currentRelease?: string;
    releases?: Array<{ version?: string; updateTo?: { url?: string } }>;
  };
  const current = manifest.releases?.find((release) => release.version === manifest.currentRelease);
  const artifactUrl = requireCandidateArtifactUrl(current?.updateTo?.url, baseUrl);
  const artifactResponse = await fetchImpl(artifactUrl);
  if (!artifactResponse.ok) throw new Error(`Candidate macOS ${arch} artifact returned ${artifactResponse.status}`);
  const targetDir = resolve(outputDir, "darwin", arch);
  await mkdir(targetDir, { recursive: true });
  await Promise.all([
    writeFile(join(targetDir, "RELEASES.json"), manifestText),
    writeFile(join(targetDir, basename(artifactUrl.pathname)), Buffer.from(await artifactResponse.arrayBuffer())),
  ]);
}

async function preserveWindowsFeed(outputDir: string, fetchImpl: typeof fetch): Promise<void> {
  const baseUrl = `${CANDIDATE_UPDATE_ROOT}/win32/x64`;
  const releasesResponse = await fetchImpl(`${baseUrl}/RELEASES`);
  if (releasesResponse.status === 404) return;
  if (!releasesResponse.ok) throw new Error(`Candidate Windows feed returned ${releasesResponse.status}`);
  const releasesText = await releasesResponse.text();
  const packageNames = releasesText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((name): name is string => Boolean(name));
  if (packageNames.length === 0) throw new Error("Candidate Windows RELEASES contains no package");
  const targetDir = resolve(outputDir, "win32", "x64");
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, "RELEASES"), releasesText);
  await Promise.all(
    packageNames.map(async (name) => {
      const artifactUrl = requireCandidateArtifactUrl(`${baseUrl}/${name}`, baseUrl);
      const response = await fetchImpl(artifactUrl);
      if (!response.ok) throw new Error(`Candidate Windows artifact returned ${response.status}`);
      await writeFile(join(targetDir, basename(artifactUrl.pathname)), Buffer.from(await response.arrayBuffer()));
    }),
  );
}

function requireCandidateArtifactUrl(value: string | undefined, baseUrl: string): URL {
  if (!value) throw new Error("Candidate feed does not reference an artifact");
  const url = new URL(value);
  const base = new URL(`${baseUrl}/`);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(`Candidate feed references an unexpected artifact URL: ${url}`);
  }
  return url;
}

async function main(): Promise<void> {
  const [outputDir] = process.argv.slice(2);
  if (!outputDir) throw new Error("Usage: preserve-candidate-update-feed OUTPUT_DIR");
  await preserveCandidateUpdateFeed({ outputDir });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
