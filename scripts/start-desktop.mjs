import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(root, "packages", "desktop");

function run(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (process.platform !== "darwin") {
  const forge = join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-forge.cmd" : "electron-forge",
  );
  run(forge, ["start"]);
} else {
  const appPath = join(desktopDir, ".desktop-host", "Maket.app");
  const electronApp = join(root, "node_modules", "electron", "dist", "Electron.app");
  rmSync(appPath, { recursive: true, force: true });
  mkdirSync(dirname(appPath), { recursive: true });
  cpSync(electronApp, appPath, { recursive: true, verbatimSymlinks: true });

  const contentsDir = join(appPath, "Contents");
  const frameworksDir = join(contentsDir, "Frameworks");
  const resourcesDir = join(contentsDir, "Resources");
  const setPlist = (path, key, value) => {
    execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, path]);
  };

  const plist = join(contentsDir, "Info.plist");
  setPlist(plist, "CFBundleDisplayName", "Maket");
  setPlist(plist, "CFBundleExecutable", "Maket");
  setPlist(plist, "CFBundleIdentifier", "io.github.ng-galien.maket");
  setPlist(plist, "CFBundleName", "Maket");
  setPlist(plist, "CFBundleShortVersionString", "2.0.0");
  setPlist(plist, "CFBundleVersion", "2.0.0");
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
  cpSync(join(desktopDir, ".desktop"), join(resourcesDir, "app", ".desktop"), { recursive: true });
  cpSync(join(desktopDir, "package.json"), join(resourcesDir, "app", "package.json"));
  cpSync(join(root, "public"), join(resourcesDir, "public"), { recursive: true });
  cpSync(join(root, "manifest.json"), join(resourcesDir, "manifest.json"));
  cpSync(join(desktopDir, "assets", "icon.png"), join(resourcesDir, "icon.png"));
  cpSync(join(desktopDir, "assets", "icon.icns"), join(resourcesDir, "icon.icns"));
  writeFileSync(join(resourcesDir, "development-host"), "Maket development host\n");
  run(join(appPath, "Contents", "MacOS", "Maket"), []);
}
