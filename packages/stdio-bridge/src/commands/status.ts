/**
 * `maket status` — report whether the server answers on the configured port,
 * plus the PID file state and data directory.
 */

import { existsSync, readFileSync } from "node:fs";
import { probeServer } from "../probe.ts";
import { readEnv } from "./_env.ts";

export async function runStatus(): Promise<void> {
	const env = readEnv();
	const reachable = await probeServer(env.port, env.host, 400);
	const pid =
		existsSync(env.pidFile) &&
		Number(readFileSync(env.pidFile, "utf-8").trim());

	const lines = [
		`url       ${env.url}`,
		`status    ${reachable ? "running" : "stopped"}`,
		`pid file  ${existsSync(env.pidFile) ? `${env.pidFile} (pid ${pid})` : "(none)"}`,
		`data dir  ${env.dataDir}`,
	];
	process.stdout.write(`${lines.join("\n")}\n`);
	if (!reachable) process.exitCode = 1;
}
