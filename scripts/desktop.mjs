#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";
import { Resvg } from "@resvg/resvg-js";
import { build } from "esbuild";
import JSZip from "jszip";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_DIR = join(ROOT, "packages", "desktop");
const DESKTOP_OUTPUT = join(DESKTOP_DIR, ".desktop");
const DESKTOP_ASSETS = join(DESKTOP_DIR, "assets");
const FORGE = join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-forge.cmd" : "electron-forge",
);
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const FORBIDDEN_RUNTIME_PACKAGES = [
  "@playwright",
  "@puppeteer",
  "@sparticuz/chromium",
  "@sparticuz/chromium-min",
  "chrome-aws-lambda",
  "chromium",
  "chromium-bidi",
  "playwright",
  "playwright-chromium",
  "playwright-core",
  "puppeteer",
  "puppeteer-core",
];
const MAX_ASAR_BYTES = 40 * 1024 * 1024;

const [action = "help", ...inputArgs] = process.argv.slice(2);
const args = [...inputArgs];
const localInstall = removeFlag(args, "--local-install");

if (localInstall && !new Set(["package", "make", "publish"]).has(action)) {
  throw new Error("--local-install is available only for package, make, or publish");
}

switch (action) {
  case "check":
    assertDesktopNode();
    break;
  case "mcpb": {
    const output = takeOption(args, "--output");
    rejectUnexpectedArgs(args);
    buildMcpbIcon();
    await buildClaudeDesktopMcpb(output ? resolve(output) : undefined);
    break;
  }
  case "build":
    rejectUnexpectedArgs(args);
    await buildClient();
    await buildDesktop();
    break;
  case "dev":
    rejectUnexpectedArgs(args);
    await buildClient();
    await buildDesktop({ sourcemap: true });
    await startDesktop();
    break;
  case "package":
  case "make":
  case "publish":
    assertDesktopNode();
    if (action === "make") {
      await rm(join(DESKTOP_DIR, "out", "make"), {
        recursive: true,
        force: true,
      });
    }
    await buildClient();
    await buildDesktop();
    await withLocalInstallMarker(localInstall, async () => {
      await run(
        FORGE,
        [action, ...args],
        {
          ...process.env,
          MAKET_LOCAL_INSTALL: localInstall ? "1" : "0",
        },
        DESKTOP_DIR,
      );
      verifyPackagedApplications();
    });
    break;
  default:
    process.stderr.write(
      [
        "Usage: npm run desktop -- <action> [options]",
        "",
        "Actions:",
        "  check                         verify the desktop Node runtime",
        "  build                         build the client and Electron sources",
        "  dev                           build and launch the local application",
        "  mcpb [--output PATH]          build the Claude Desktop connector",
        "  package [forge options]       create the unpacked application",
        "  make [forge options]          create platform distributables",
        "  publish [forge options]       publish a reviewed draft release",
        "",
        "Packaging options:",
        "  --local-install               mark an installer as local and disable updates",
        "",
      ].join("\n"),
    );
    process.exitCode = action === "help" ? 0 : 1;
}

function assertDesktopNode() {
  const versionFile = join(ROOT, ".desktop-node-version");
  const requiredVersion = readFileSync(versionFile, "utf8").trim();
  const requiredMajor = Number.parseInt(requiredVersion, 10);
  const currentMajor = Number.parseInt(process.versions.node, 10);
  if (!Number.isInteger(requiredMajor)) {
    throw new Error(`Invalid desktop Node version in ${versionFile}: ${JSON.stringify(requiredVersion)}`);
  }
  if (currentMajor !== requiredMajor) {
    throw new Error(
      [
        `Maket App packaging requires Node ${requiredVersion}; received Node ${process.versions.node}.`,
        "The single source of truth is .desktop-node-version.",
        `Switch runtimes before packaging, for example: fnm exec --using ${requiredVersion} npm run desktop -- make.`,
      ].join("\n"),
    );
  }
}

async function buildClient() {
  await run(NPM, ["run", "build", "-w", "@maket/client"]);
}

async function buildDesktop({ sourcemap = false } = {}) {
  buildDesktopIcons();
  await buildClaudeDesktopMcpb();
  await rm(DESKTOP_OUTPUT, { recursive: true, force: true });
  mkdirSync(DESKTOP_OUTPUT, { recursive: true });

  const [mainResult] = await Promise.all([
    build({
      entryPoints: [join(DESKTOP_DIR, "src", "main.ts")],
      outfile: join(DESKTOP_OUTPUT, "main.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      external: ["electron", "@resvg/resvg-js-*"],
      banner: {
        js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
      },
      sourcemap,
      metafile: true,
    }),
    build({
      entryPoints: [join(DESKTOP_DIR, "src", "preload.ts")],
      outfile: join(DESKTOP_OUTPUT, "preload.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["electron"],
      sourcemap,
    }),
  ]);

  const forbiddenInputs = Object.keys(mainResult.metafile.inputs).filter(containsForbiddenRuntimePackage);
  if (forbiddenInputs.length > 0) {
    throw new Error(`Desktop bundle contains forbidden headless-browser packages:\n${forbiddenInputs.join("\n")}`);
  }
}

function buildDesktopIcons() {
  function wrapChunk(type, data) {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(data.length + header.length, 4);
    return Buffer.concat([header, data]);
  }

  const icnsChunks = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ].map(([type, size]) => wrapChunk(type, renderMaketIcon(size)));
  const icnsBody = Buffer.concat(icnsChunks);
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write("icns", 0, 4, "ascii");
  icnsHeader.writeUInt32BE(icnsBody.length + icnsHeader.length, 4);

  const icoImage = renderMaketIcon(256);
  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(0, 0);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(1, 4);
  icoHeader.writeUInt16LE(1, 10);
  icoHeader.writeUInt16LE(32, 12);
  icoHeader.writeUInt32LE(icoImage.length, 14);
  icoHeader.writeUInt32LE(icoHeader.length, 18);

  mkdirSync(DESKTOP_ASSETS, { recursive: true });
  writeFileSync(join(DESKTOP_ASSETS, "icon.png"), renderMaketIcon(1024));
  writeFileSync(join(DESKTOP_ASSETS, "icon.icns"), Buffer.concat([icnsHeader, icnsBody]));
  writeFileSync(join(DESKTOP_ASSETS, "icon.ico"), Buffer.concat([icoHeader, icoImage]));
  writeFileSync(join(DESKTOP_ASSETS, "dmg-background.png"), renderPlainDmgBackground());
}

function buildMcpbIcon() {
  mkdirSync(DESKTOP_ASSETS, { recursive: true });
  writeFileSync(join(DESKTOP_ASSETS, "icon.png"), renderMaketIcon(1024));
}

function renderMaketIcon(size) {
  const sourcePath = join(ROOT, "packages", "client", "public", "favicon.svg");
  const source = readFileSync(sourcePath, "utf8").replace('viewBox="0 0 100 100"', 'viewBox="-12 -12 124 124"');
  return new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();
}

function renderPlainDmgBackground() {
  return new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="658" height="498"><rect width="658" height="498" fill="#f7f7f7"/></svg>',
  )
    .render()
    .asPng();
}

async function buildClaudeDesktopMcpb(outputPath) {
  const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const desktopPackageJson = JSON.parse(await readFile(join(DESKTOP_DIR, "package.json"), "utf8"));
  if (desktopPackageJson.version !== packageJson.version) {
    throw new Error(
      `Cannot build Claude Desktop MCPB: Maket is ${packageJson.version}, but maket-app is ${desktopPackageJson.version}`,
    );
  }
  const output = outputPath ?? join(DESKTOP_ASSETS, "maket-claude-desktop.mcpb");
  const bridgeOutput = join(DESKTOP_ASSETS, ".maket-claude-desktop-bridge.mjs");
  const archiveEntryOptions = {
    date: new Date("1980-01-01T00:00:00.000Z"),
    unixPermissions: 0o100644,
  };

  await build({
    entryPoints: [join(ROOT, "packages", "stdio-bridge", "src", "desktop-entry.ts")],
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
    zip.file("icon.png", await readFile(join(DESKTOP_ASSETS, "icon.png")), archiveEntryOptions);
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
          icon: "icon.png",
          author: {
            name: "Alexandre Boyer",
            url: "https://github.com/ng-galien/maket",
          },
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
    await rm(bridgeOutput, { force: true });
  }
}

async function startDesktop() {
  if (process.platform !== "darwin") {
    await run(FORGE, ["start"], process.env, DESKTOP_DIR);
    return;
  }

  const appPath = join(DESKTOP_DIR, ".desktop-host", "Maket.app");
  const electronApp = join(ROOT, "node_modules", "electron", "dist", "Electron.app");
  rmSync(appPath, { recursive: true, force: true });
  mkdirSync(dirname(appPath), { recursive: true });
  cpSync(electronApp, appPath, {
    recursive: true,
    verbatimSymlinks: true,
  });

  const contentsDir = join(appPath, "Contents");
  const frameworksDir = join(contentsDir, "Frameworks");
  const resourcesDir = join(contentsDir, "Resources");
  const packageJson = JSON.parse(readFileSync(join(DESKTOP_DIR, "package.json"), "utf8"));
  const setPlist = (path, key, value) => {
    execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, path]);
  };

  const plist = join(contentsDir, "Info.plist");
  setPlist(plist, "CFBundleDisplayName", "Maket");
  setPlist(plist, "CFBundleExecutable", "Maket");
  setPlist(plist, "CFBundleIdentifier", "io.github.ng-galien.maket");
  setPlist(plist, "CFBundleName", "Maket");
  setPlist(plist, "CFBundleShortVersionString", packageJson.version);
  setPlist(plist, "CFBundleVersion", packageJson.version);
  setPlist(plist, "CFBundleIconFile", "icon.icns");
  renameSync(join(contentsDir, "MacOS", "Electron"), join(contentsDir, "MacOS", "Maket"));

  for (const suffix of ["", " (GPU)", " (Plugin)", " (Renderer)"]) {
    const electronName = `Electron Helper${suffix}`;
    const maketName = `Maket Helper${suffix}`;
    const helperPath = join(frameworksDir, `${electronName}.app`);
    const helperPlist = join(helperPath, "Contents", "Info.plist");
    setPlist(helperPlist, "CFBundleDisplayName", maketName);
    setPlist(helperPlist, "CFBundleExecutable", maketName);
    setPlist(helperPlist, "CFBundleIdentifier", "io.github.ng-galien.maket.helper");
    setPlist(helperPlist, "CFBundleName", suffix ? maketName : "Maket");
    renameSync(join(helperPath, "Contents", "MacOS", electronName), join(helperPath, "Contents", "MacOS", maketName));
    renameSync(helperPath, join(frameworksDir, `${maketName}.app`));
  }

  rmSync(join(resourcesDir, "default_app.asar"), { force: true });
  mkdirSync(join(resourcesDir, "app"), { recursive: true });
  cpSync(DESKTOP_OUTPUT, join(resourcesDir, "app", ".desktop"), { recursive: true });
  cpSync(join(DESKTOP_DIR, "package.json"), join(resourcesDir, "app", "package.json"));
  const nativeRenderer = `@resvg/resvg-js-darwin-${process.arch}`;
  const nativeRendererTarget = join(resourcesDir, "app", "node_modules", nativeRenderer);
  mkdirSync(dirname(nativeRendererTarget), { recursive: true });
  cpSync(join(ROOT, "node_modules", nativeRenderer), nativeRendererTarget, {
    recursive: true,
    dereference: true,
  });
  cpSync(join(ROOT, "public"), join(resourcesDir, "public"), {
    recursive: true,
  });
  cpSync(join(ROOT, "manifest.json"), join(resourcesDir, "manifest.json"));
  cpSync(join(DESKTOP_ASSETS, "icon.png"), join(resourcesDir, "icon.png"));
  cpSync(join(DESKTOP_ASSETS, "icon.icns"), join(resourcesDir, "icon.icns"));
  writeFileSync(join(resourcesDir, "development-host"), `${ROOT}\n`);
  await run(join(appPath, "Contents", "MacOS", "Maket"), []);
}

function verifyPackagedApplications() {
  const out = join(DESKTOP_DIR, "out");
  const archives = findFiles(out, "app.asar");
  if (archives.length === 0) {
    throw new Error(`Desktop packaging produced no app.asar under ${out}`);
  }
  for (const archive of archives) {
    const entries = listPackage(archive);
    const forbidden = entries.filter(containsForbiddenRuntimePackage);
    if (forbidden.length > 0) {
      throw new Error(
        `Packaged desktop application contains forbidden headless-browser files:\n${forbidden.join("\n")}`,
      );
    }
    const bytes = statSync(archive).size;
    if (bytes > MAX_ASAR_BYTES) {
      throw new Error(
        `Packaged desktop application is unexpectedly large: ${Math.ceil(bytes / 1024 / 1024)} MiB (maximum ${MAX_ASAR_BYTES / 1024 / 1024} MiB)`,
      );
    }
    process.stdout.write(
      `Desktop artifact verified: ${archive} (${(bytes / 1024 / 1024).toFixed(1)} MiB, no headless browser packages)\n`,
    );
  }
}

function containsForbiddenRuntimePackage(path) {
  const normalized = path.replaceAll("\\", "/");
  return FORBIDDEN_RUNTIME_PACKAGES.some((name) => {
    const packagePath = `node_modules/${name}`;
    return (
      normalized === packagePath ||
      normalized.startsWith(`${packagePath}/`) ||
      normalized.includes(`/${packagePath}/`) ||
      normalized.endsWith(`/${packagePath}`)
    );
  });
}

function findFiles(directory, basename) {
  if (!directory || !statSafe(directory)?.isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(target, basename));
    else if (entry.name === basename) files.push(target);
  }
  return files;
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

async function withLocalInstallMarker(enabled, task) {
  if (!enabled) return task();
  const marker = join(DESKTOP_ASSETS, "local-install");
  const previous = statSafe(marker)?.isFile() ? readFileSync(marker) : undefined;
  mkdirSync(DESKTOP_ASSETS, { recursive: true });
  writeFileSync(marker, "Maket local installer build.\n");
  try {
    return await task();
  } finally {
    if (previous) writeFileSync(marker, previous);
    else rmSync(marker, { force: true });
  }
}

function removeFlag(values, flag) {
  const index = values.indexOf(flag);
  if (index < 0) return false;
  values.splice(index, 1);
  return true;
}

function takeOption(values, option) {
  const index = values.indexOf(option);
  if (index < 0) return undefined;
  const value = values[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  values.splice(index, 2);
  return value;
}

function rejectUnexpectedArgs(values) {
  if (values.length > 0) {
    throw new Error(`Unexpected desktop arguments: ${values.join(" ")}`);
  }
}

function run(command, commandArgs, env = process.env, cwd = ROOT) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env,
      stdio: "inherit",
    });
    const forward = (signal) => child.kill(signal);
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", forward);
      process.removeListener("SIGTERM", forward);
      if (code === 0) resolveRun();
      else {
        rejectRun(new Error(`${command} ${commandArgs.join(" ")} failed (${signal ?? code ?? "unknown"})`));
      }
    });
  });
}
