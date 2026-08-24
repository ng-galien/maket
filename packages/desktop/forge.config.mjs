import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { desktopRuntimeDependencies } from "../../scripts/desktop-runtime-deps.mjs";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(desktopDir, "../..");
const repositoryNodeModules = join(repositoryDir, "node_modules");

const releaseVersion = process.env.npm_package_version ?? "0.0.0";
const prerelease = releaseVersion.includes("-");
const signDesktop = process.env.MAKET_SIGN_DESKTOP === "1";
const installBuild = process.env.MAKET_INSTALL_BUILD === "1";
const notarizeMac =
  signDesktop && process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined;
const signWindows = signDesktop && process.env.WINDOWS_CERTIFICATE_FILE && process.env.WINDOWS_CERTIFICATE_PASSWORD;

function resolvePackageRoot(packageName, fromPackageJson) {
  let current = dirname(fromPackageJson);
  for (;;) {
    const candidate = join(current, "node_modules", packageName);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function copyRuntimeDependencies(buildPath) {
  const copied = new Set();

  function copyPackage(packageName, fromPackageJson = join(repositoryDir, "package.json")) {
    const sourceDir = resolvePackageRoot(packageName, fromPackageJson);
    if (!sourceDir) return;
    if (copied.has(sourceDir)) return;
    copied.add(sourceDir);

    const modulePath = relative(repositoryNodeModules, sourceDir);
    if (modulePath.startsWith("..")) {
      throw new Error(`Runtime dependency ${packageName} resolved outside the repository node_modules`);
    }

    const targetDir = join(buildPath, "node_modules", modulePath);
    mkdirSync(dirname(targetDir), { recursive: true });
    if (!existsSync(targetDir)) {
      const nestedNodeModules = join(sourceDir, "node_modules");
      cpSync(sourceDir, targetDir, {
        recursive: true,
        dereference: true,
        filter: (source) => source !== nestedNodeModules && !source.startsWith(`${nestedNodeModules}/`),
      });
    }

    const packagePath = join(sourceDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.optionalDependencies,
    };
    for (const dependency of Object.keys(dependencies)) {
      copyPackage(dependency, packagePath);
    }
  }

  for (const dependency of desktopRuntimeDependencies) copyPackage(dependency);
}

export default {
  packagerConfig: {
    asar: true,
    prune: false,
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
      ...(installBuild ? ["assets/local-install"] : []),
    ],
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, done) => {
        try {
          copyRuntimeDependencies(buildPath);
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
    { name: "@electron-forge/maker-dmg", platforms: ["darwin"] },
    ...(installBuild ? [] : [{ name: "@electron-forge/maker-zip", platforms: ["darwin"] }]),
    { name: "@electron-forge/maker-deb", config: {} },
    { name: "@electron-forge/maker-rpm", config: {} },
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
