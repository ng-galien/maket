import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareDesktopFeeds, preserveDesktopFeeds } from "../../../scripts/prepare-desktop-update-feeds.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture(version: string) {
  const root = await mkdtemp(join(tmpdir(), "maket-auto-feeds-"));
  roots.push(root);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicText = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url").toString("base64");
  for (const arch of ["arm64", "x64"]) {
    const file = `Maket-darwin-${arch}-${version}.zip`,
      bytes = Buffer.from(`archive ${arch} ${version}`);
    await writeFile(join(root, file), bytes);
    await writeFile(
      join(root, `sparkle-${arch}.json`),
      JSON.stringify({
        version,
        file,
        length: bytes.length,
        signature: sign(null, bytes, privateKey).toString("base64"),
      }),
    );
  }
  await writeFile(join(root, "Maket-Linux-x64.deb"), "deb");
  await writeFile(join(root, "Maket-Linux-x64.rpm"), "rpm");
  return { root, publicText };
}
describe("automatic update release feeds", () => {
  it("publishes authenticated Mac archives and Linux packages for a major release", async () => {
    const { root, publicText } = await fixture("3.0.0");
    const output = join(root, "feeds");
    await prepareDesktopFeeds(root, output, "3.0.0", publicText);
    const feed = await readFile(join(output, "stable/darwin/arm64/appcast.xml"), "utf8");
    expect(feed).toContain("<sparkle:version>3.0.0</sparkle:version>");
    expect(feed).toContain("https://github.com/ng-galien/maket/releases/download/v3.0.0/Maket-darwin-arm64-3.0.0.zip");
    expect(feed).toContain("sparkle:edSignature=");
    const linux = JSON.parse(await readFile(join(output, "stable/linux/x64/latest-linux.yml"), "utf8"));
    expect(linux.files).toHaveLength(2);
    expect(linux.files[0].sha512).toBe(createHash("sha512").update("deb").digest("base64"));
    expect(await readFile(join(output, "candidate/darwin/arm64/appcast.xml"), "utf8")).toBe(feed);
  });
  it("refuses an altered archive before publishing its feed", async () => {
    const { root, publicText } = await fixture("3.0.0");
    await writeFile(join(root, "Maket-darwin-arm64-3.0.0.zip"), "tampered");
    await expect(prepareDesktopFeeds(root, join(root, "feeds"), "3.0.0", publicText)).rejects.toThrow(
      "Invalid update archive signature",
    );
  });
  it("keeps a newer candidate when a lower stable release is published", async () => {
    const candidate = await fixture("3.0.0-rc.1"),
      stable = await fixture("2.3.0");
    const output = join(candidate.root, "feeds");
    await prepareDesktopFeeds(candidate.root, output, "3.0.0-rc.1", candidate.publicText);
    await expect(readFile(join(output, "stable/linux/x64/latest-linux.yml"))).rejects.toThrow();
    await prepareDesktopFeeds(stable.root, output, "2.3.0", stable.publicText);
    expect(JSON.parse(await readFile(join(output, "candidate/linux/x64/latest-linux.yml"), "utf8")).version).toBe(
      "3.0.0-rc.1",
    );
    expect(JSON.parse(await readFile(join(output, "stable/linux/x64/latest-linux.yml"), "utf8")).version).toBe("2.3.0");
  });
  it("stops a website deployment when an existing feed cannot be read", async () => {
    const { root } = await fixture("3.0.0");
    await expect(preserveDesktopFeeds(root, async () => new Response("unavailable", { status: 503 }))).rejects.toThrow(
      "Could not preserve",
    );
  });
});
