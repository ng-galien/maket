import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(desktopDir, "../..");
const repositoryNodeModules = join(repositoryDir, "node_modules");

const releaseVersion = process.env.npm_package_version ?? "0.0.0";
const prerelease = releaseVersion.includes("-");
const signDesktop = process.env.MAKET_SIGN_DESKTOP === "1";
const localInstall = process.env.MAKET_LOCAL_INSTALL === "1";
const notarizeMac =
  signDesktop && process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined;
const signWindows = signDesktop && process.env.WINDOWS_CERTIFICATE_FILE && process.env.WINDOWS_CERTIFICATE_PASSWORD;

function nativeRendererPackage(platform, arch) {
  const key = `${platform}-${arch}`;
  const packages = {
    "darwin-arm64": "@resvg/resvg-js-darwin-arm64",
    "darwin-x64": "@resvg/resvg-js-darwin-x64",
    "linux-arm64": "@resvg/resvg-js-linux-arm64-gnu",
    "linux-x64": "@resvg/resvg-js-linux-x64-gnu",
    "win32-arm64": "@resvg/resvg-js-win32-arm64-msvc",
    "win32-ia32": "@resvg/resvg-js-win32-ia32-msvc",
    "win32-x64": "@resvg/resvg-js-win32-x64-msvc",
  };
  const packageName = packages[key];
  if (!packageName) throw new Error(`Unsupported desktop render target: ${key}`);
  return packageName;
}

function copyNativeRenderer(buildPath, platform, arch) {
  const packageName = nativeRendererPackage(platform, arch);
  const sourceDir = join(repositoryNodeModules, packageName);
  if (!existsSync(join(sourceDir, "package.json"))) {
    throw new Error(`Native desktop renderer ${packageName} is not installed`);
  }
  const targetDir = join(buildPath, "node_modules", packageName);
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
}

export default {
  packagerConfig: {
    asar: true,
    name: "Maket",
    executableName: "Maket",
    appBundleId: "io.github.ng-galien.maket",
    icon: "./assets/icon",
    ignore: [/^\/(?:\.desktop-host|assets|node_modules|out|src)(?:\/|$)/, /^\/(?:forge\.config\.mjs|tsconfig\.json)$/],
    extraResource: [
      "../../public",
      "../../manifest.json",
      "../../plugin/codex/skills/maket",
      "assets/icon.png",
      "assets/maket-claude-desktop.mcpb",
      ...(localInstall ? ["assets/local-install"] : []),
    ],
    afterCopy: [
      (buildPath, _electronVersion, platform, arch, done) => {
        try {
          copyNativeRenderer(buildPath, platform, arch);
          done();
        } catch (error) {
          done(error);
        }
      },
    ],
    afterComplete: [
      (buildPath, _electronVersion, platform, _arch, done) => {
        try {
          if (platform === "darwin" && !signDesktop) {
            const appPath = join(buildPath, "Maket.app");
            execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath], {
              stdio: "inherit",
            });
          }
          done();
        } catch (error) {
          done(error);
        }
      },
    ],
    osxSign: process.platform === "darwin" && signDesktop ? {} : undefined,
    osxNotarize: process.platform === "darwin" ? notarizeMac : undefined,
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "maket_app",
        certificateFile: signWindows ? process.env.WINDOWS_CERTIFICATE_FILE : undefined,
        certificatePassword: signWindows ? process.env.WINDOWS_CERTIFICATE_PASSWORD : undefined,
      },
    },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        icon: join(desktopDir, "assets", "icon.icns"),
        background: join(desktopDir, "assets", "dmg-background.png"),
        iconSize: 112,
        contents: (options) => [
          { x: 180, y: 320, type: "file", path: options.appPath },
          { x: 478, y: 320, type: "link", path: "/Applications" },
        ],
        additionalDMGOptions: {
          window: { size: { width: 658, height: 498 } },
        },
      },
    },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] },
    { name: "@electron-forge/maker-deb", config: { options: { bin: "Maket" } } },
    { name: "@electron-forge/maker-rpm", config: { options: { bin: "Maket" } } },
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: { owner: "ng-galien", name: "maket" },
        prerelease,
        draft: true,
      },
    },
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};
