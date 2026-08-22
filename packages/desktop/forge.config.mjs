import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";

export default {
  packagerConfig: {
    asar: true,
    name: "Maket",
    executableName: "Maket",
    appBundleId: "io.github.ng-galien.maket",
    icon: "./assets/icon",
    extraResource: ["../../public", "../../manifest.json", "assets/icon.png"],
  },
  rebuildConfig: {},
  makers: [
    { name: "@electron-forge/maker-squirrel", config: { name: "maket" } },
    { name: "@electron-forge/maker-dmg", platforms: ["darwin"] },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] },
    { name: "@electron-forge/maker-deb", config: {} },
    { name: "@electron-forge/maker-rpm", config: {} },
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};
