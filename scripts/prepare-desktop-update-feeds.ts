import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gt } from "semver";

const ROOT_URL = "https://ng-galien.github.io/maket/updates";
const DOWNLOAD = "https://github.com/ng-galien/maket/releases/download";
const FEEDS = ["darwin/arm64/appcast.xml", "darwin/x64/appcast.xml", "linux/x64/latest-linux.yml"];

export async function preserveDesktopFeeds(output: string, fetchImpl = fetch): Promise<void> {
  for (const channel of ["stable", "candidate"]) {
    for (const file of FEEDS) {
      const response = await fetchImpl(`${ROOT_URL}/${channel}/${file}`, { signal: AbortSignal.timeout(30000) });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`Could not preserve ${channel}/${file}: ${response.status}`);
      await writeFeed(output, `${channel}/${file}`, await response.text());
    }
  }
}

export async function prepareDesktopFeeds(
  artifacts: string,
  output: string,
  version: string,
  publicKey?: string,
): Promise<void> {
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) throw new Error("Invalid release version");
  const allFiles = await artifactFiles(artifacts);
  const filePath = (name: string) => {
    const matches = allFiles.filter((path) => basename(path) === name);
    if (matches.length !== 1) throw new Error(`Expected exactly one ${name}`);
    return matches[0] as string;
  };
  const url = (file: string) => `${DOWNLOAD}/v${version}/${encodeURIComponent(file)}`;
  const channels = version.includes("-") ? ["candidate"] : ["stable", "candidate"];
  for (const arch of ["arm64", "x64"]) {
    const meta = JSON.parse(await readFile(filePath(`sparkle-${arch}.json`), "utf8"));
    const expected = `Maket-darwin-${arch}-${version}.zip`;
    if (
      meta.version !== version ||
      meta.file !== expected ||
      !/^[A-Za-z0-9+/]{86}==$/.test(meta.signature) ||
      !Number.isSafeInteger(meta.length) ||
      meta.length <= 0
    )
      throw new Error(`Invalid Sparkle metadata for ${arch}`);
    const archive = await readFile(filePath(expected));
    const publicRaw = Buffer.from(
      (
        publicKey ?? (await readFile(new URL("../packages/desktop/update-public-key.txt", import.meta.url), "utf8"))
      ).trim(),
      "base64",
    );
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicRaw]),
      format: "der",
      type: "spki",
    });
    if (archive.length !== meta.length || !verify(null, archive, key, Buffer.from(meta.signature, "base64")))
      throw new Error("Invalid update archive signature");
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Maket</title><item><title>Maket ${version}</title><sparkle:version>${version}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><enclosure url="${url(expected)}" length="${meta.length}" sparkle:edSignature="${meta.signature}" type="application/octet-stream" /></item></channel></rss>\n`;
    for (const channel of channels)
      await writeVersionedFeed(output, `${channel}/darwin/${arch}/appcast.xml`, xml, version);
  }
  const files = await Promise.all(
    ["deb", "rpm"].map(async (extension) => {
      const name = `Maket-Linux-x64.${extension}`;
      const bytes = await readFile(filePath(name));
      return { url: url(name), sha512: createHash("sha512").update(bytes).digest("base64"), size: bytes.length };
    }),
  );
  for (const channel of channels)
    await writeVersionedFeed(
      output,
      `${channel}/linux/x64/latest-linux.yml`,
      JSON.stringify({ version, files }, null, 2) + "\n",
      version,
    );
}

async function writeVersionedFeed(output: string, path: string, text: string, version: string): Promise<void> {
  try {
    const prior = await readFile(join(output, path), "utf8");
    const previousVersion = path.endsWith(".xml")
      ? prior.match(/<sparkle:version>([^<]+)<\/sparkle:version>/)?.[1]
      : JSON.parse(prior).version;
    if (previousVersion && gt(previousVersion, version)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFeed(output, path, text);
}
async function writeFeed(output: string, path: string, text: string): Promise<void> {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
}
async function artifactFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? artifactFiles(join(root, entry.name)) : Promise.resolve([join(root, entry.name)]),
      ),
    )
  ).flat();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, output, artifacts, version] = process.argv.slice(2);
  if (!output) throw new Error("Usage: prepare-desktop-update-feeds preserve|prepare OUTPUT [ARTIFACTS VERSION]");
  if (action === "preserve") await preserveDesktopFeeds(output);
  else if (action === "prepare" && artifacts && version) await prepareDesktopFeeds(artifacts, output, version);
  else throw new Error("Invalid update feed command");
}
