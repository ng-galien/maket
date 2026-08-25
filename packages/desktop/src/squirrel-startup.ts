import { spawn as spawnProcess } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

interface SquirrelChild {
  once(event: "close" | "error", listener: () => void): unknown;
}

export interface SquirrelStartupInputs {
  platform: NodeJS.Platform;
  command: string | undefined;
  execPath: string;
  quit: () => void;
  spawn?: (command: string, args: string[], options: { detached: true }) => SquirrelChild;
}

export function handleSquirrelStartup({
  platform,
  command,
  execPath,
  quit,
  spawn = spawnProcess,
}: SquirrelStartupInputs): boolean {
  if (platform !== "win32") return false;
  if (command === "--squirrel-obsolete") {
    quit();
    return true;
  }

  const action =
    command === "--squirrel-install" || command === "--squirrel-updated"
      ? "--createShortcut"
      : command === "--squirrel-uninstall"
        ? "--removeShortcut"
        : undefined;
  if (!action) return false;

  const updateExe = resolve(dirname(execPath), "..", "Update.exe");
  const child = spawn(updateExe, [`${action}=${basename(execPath)}`], { detached: true });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    quit();
  };
  child.once("close", stop);
  child.once("error", stop);
  return true;
}
