import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "packages", "client", "public", "favicon.svg");
const assetsDir = join(root, "packages", "desktop", "assets");

const source = readFileSync(sourcePath, "utf8").replace('viewBox="0 0 100 100"', 'viewBox="-12 -12 124 124"');

function render(size) {
  return new Resvg(source, {
    fitTo: { mode: "width", value: size },
  })
    .render()
    .asPng();
}

function wrapChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + header.length, 4);
  return Buffer.concat([header, data]);
}

function createIcns() {
  const chunks = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ].map(([type, size]) => wrapChunk(type, render(size)));
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(body.length + header.length, 4);
  return Buffer.concat([header, body]);
}

function createIco() {
  const image = render(256);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, image]);
}

mkdirSync(assetsDir, { recursive: true });
writeFileSync(join(assetsDir, "icon.png"), render(1024));
writeFileSync(join(assetsDir, "icon.icns"), createIcns());
writeFileSync(join(assetsDir, "icon.ico"), createIco());
