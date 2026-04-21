/**
 * `maket logs` — tail server / bridge logs from MAKET_DATA_DIR.
 *
 * Defaults to the spawned-server stdout (server-spawn.log). Pass --bridge to
 * watch the stdio-bridge log instead. Plain spawn of `tail -F` for follow
 * semantics matching what users expect from `journalctl -f` style tools.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readEnv } from "./_env.ts";

export function runLogs(args: string[]): void {
	const env = readEnv();
	const wantBridge = args.includes("--bridge");
	const follow = !args.includes("--no-follow");
	const path = wantBridge
		? env.bridgeLog
		: join(env.dataDir, "server-spawn.log");

	if (!existsSync(path)) {
		process.stderr.write(`maket: no log at ${path}\n`);
		process.exitCode = 1;
		return;
	}

	const tailArgs = follow ? ["-F", path] : ["-n", "200", path];
	const tail = spawn("tail", tailArgs, { stdio: "inherit" });
	tail.on("exit", (code) => {
		process.exit(code ?? 0);
	});
}
