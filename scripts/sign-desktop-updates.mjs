import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [directory, arch] = process.argv.slice(2);
if (!directory || !["arm64", "x64"].includes(arch)) throw new Error("Usage: sign-desktop-updates DIRECTORY arm64|x64");
const secret =
  process.env.MAKET_UPDATE_PRIVATE_KEY?.trim() ??
  (process.env.MAKET_UPDATE_KEY_FILE ? readFileSync(process.env.MAKET_UPDATE_KEY_FILE, "utf8").trim() : "");
const seed = Buffer.from(secret, "base64");
if (seed.length !== 32) throw new Error("A 32-byte Ed25519 update signing seed is required");
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
  format: "der",
  type: "pkcs8",
});
const publicKey = createPublicKey(key).export({ format: "jwk" });
if (
  Buffer.from(publicKey.x, "base64url").toString("base64") !==
  readFileSync(join(root, "packages/desktop/update-public-key.txt"), "utf8").trim()
) {
  throw new Error("Update signing key does not match the public key embedded in Maket");
}
const files = readdirSync(directory).filter(
  (name) => name.startsWith(`Maket-darwin-${arch}-`) && name.endsWith(".zip"),
);
if (files.length !== 1) throw new Error("Expected exactly one macOS update archive");
const file = files[0];
const archive = readFileSync(join(directory, file));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const metadata = { version, file, length: archive.length, signature: sign(null, archive, key).toString("base64") };
writeFileSync(join(directory, `sparkle-${arch}.json`), JSON.stringify(metadata, null, 2) + "\n");
console.log(`Signed ${file} for automatic updates`);
