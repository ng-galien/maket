import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import JSZip from "jszip";

const root = resolve(import.meta.dirname, "..");
const desktopAssets = join(root, "packages", "desktop", "assets");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const desktopPackageJson = JSON.parse(await readFile(join(root, "packages", "desktop", "package.json"), "utf8"));
if (desktopPackageJson.version !== packageJson.version) {
  throw new Error(
    `Cannot build Claude Desktop MCPB: Maket is ${packageJson.version}, but maket-app is ${desktopPackageJson.version}`,
  );
}
const output = process.argv[2] ? resolve(process.argv[2]) : join(desktopAssets, "maket-claude-desktop.mcpb");
const bridgeOutput = join(desktopAssets, ".maket-claude-desktop-bridge.mjs");
const archiveDate = new Date("1980-01-01T00:00:00.000Z");
const archiveEntryOptions = { date: archiveDate, unixPermissions: 0o100644 };

await build({
  entryPoints: [join(root, "packages", "stdio-bridge", "src", "desktop-entry.ts")],
  outfile: bridgeOutput,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
});

try {
  const zip = new JSZip();
  zip.file("index.mjs", await readFile(bridgeOutput), archiveEntryOptions);
  zip.file("package.json", `${JSON.stringify({ type: "module" }, null, 2)}\n`, archiveEntryOptions);
  zip.file(
    "manifest.json",
    `${JSON.stringify(
      {
        manifest_version: "0.3",
        name: "maket-app-bridge",
        display_name: "Maket App",
        version: packageJson.version,
        description: "Connect Claude Desktop to the server embedded in Maket App.",
        author: { name: "Alexandre Boyer", url: "https://github.com/ng-galien/maket" },
        license: "MIT",
        server: {
          type: "node",
          entry_point: "index.mjs",
          mcp_config: {
            command: "node",
            args: [`${"$"}{__dirname}/index.mjs`],
            env: { MAKET_CONNECT_ONLY: "1", MAKET_PORT: "24843" },
          },
        },
        compatibility: {
          claude_desktop: ">=0.10.0",
          platforms: ["darwin", "win32"],
        },
      },
      null,
      2,
    )}\n`,
    archiveEntryOptions,
  );
  await writeFile(
    output,
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      platform: "UNIX",
    }),
  );
  process.stdout.write(`Claude Desktop MCPB: ${output}\n`);
} finally {
  const { rm } = await import("node:fs/promises");
  await rm(bridgeOutput, { force: true });
}
