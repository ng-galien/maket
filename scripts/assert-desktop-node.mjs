import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const versionFile = resolve(import.meta.dirname, "../.desktop-node-version");
const requiredVersion = readFileSync(versionFile, "utf8").trim();
const requiredMajor = Number.parseInt(requiredVersion, 10);
const [currentMajor] = process.versions.node.split(".").map(Number);

if (!Number.isInteger(requiredMajor)) {
  process.stderr.write(`Invalid desktop Node version in ${versionFile}: ${JSON.stringify(requiredVersion)}.\n`);
  process.exitCode = 1;
} else if (currentMajor !== requiredMajor) {
  process.stderr.write(
    [
      `Maket App packaging requires Node ${requiredVersion}; received Node ${process.versions.node}.`,
      "The single source of truth is .desktop-node-version.",
      `Switch runtimes before packaging, for example: nvm install ${requiredVersion} && nvm use ${requiredVersion}`,
      "",
    ].join("\n"),
  );
  process.exitCode = 1;
}
