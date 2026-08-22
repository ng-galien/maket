import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "packages", "client", "public", "favicon.svg");
const assetsDir = join(root, "packages", "desktop", "assets");
const iconsetDir = join(assetsDir, "icon.iconset");

const source = readFileSync(sourcePath, "utf8").replace('viewBox="0 0 100 100"', 'viewBox="-12 -12 124 124"');

function render(size) {
  return new Resvg(source, {
    fitTo: { mode: "width", value: size },
  })
    .render()
    .asPng();
}

mkdirSync(assetsDir, { recursive: true });
writeFileSync(join(assetsDir, "icon.png"), render(1024));

if (process.platform === "darwin") {
  rmSync(iconsetDir, { recursive: true, force: true });
  mkdirSync(iconsetDir, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconsetDir, `icon_${size}x${size}.png`), render(size));
    writeFileSync(join(iconsetDir, `icon_${size}x${size}@2x.png`), render(size * 2));
  }
  execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", join(assetsDir, "icon.icns")]);
  rmSync(iconsetDir, { recursive: true, force: true });
}
