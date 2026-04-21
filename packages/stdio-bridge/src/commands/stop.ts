/**
 * `maket stop` — terminate a server started by `maket start`.
 *
 * Reads the PID file written by start, sends SIGTERM, then waits briefly for
 * the port to free. If the PID file is stale (process gone) we just clean up.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { probeServer } from "../probe.ts";
import { readEnv } from "./_env.ts";

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForPortFree(
	port: number,
	host: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!(await probeServer(port, host, 200))) return true;
		await new Promise((r) => setTimeout(r, 150));
	}
	return false;
}

export async function runStop(): Promise<void> {
	const env = readEnv();

	if (!existsSync(env.pidFile)) {
		if (await probeServer(env.port, env.host, 300)) {
			process.stderr.write(
				`maket: server is running on ${env.url} but no PID file at ${env.pidFile}.\n` +
					"       Stop it manually (lsof -ti:" +
					env.port +
					" | xargs kill).\n",
			);
			process.exitCode = 1;
			return;
		}
		process.stdout.write("maket: not running.\n");
		return;
	}

	const pid = Number(readFileSync(env.pidFile, "utf-8").trim());
	if (!Number.isInteger(pid) || pid <= 0) {
		process.stderr.write(`maket: invalid PID file ${env.pidFile}\n`);
		unlinkSync(env.pidFile);
		process.exitCode = 1;
		return;
	}

	if (!isAlive(pid)) {
		process.stdout.write(`maket: stale PID ${pid}, cleaning up.\n`);
		unlinkSync(env.pidFile);
		return;
	}

	process.stdout.write(`maket: sending SIGTERM to pid ${pid}…\n`);
	try {
		process.kill(pid, "SIGTERM");
	} catch (e) {
		process.stderr.write(`maket: kill failed: ${(e as Error).message}\n`);
		process.exitCode = 1;
		return;
	}

	const freed = await waitForPortFree(env.port, env.host, 5_000);
	if (existsSync(env.pidFile)) unlinkSync(env.pidFile);

	if (!freed) {
		process.stderr.write(
			`maket: port ${env.port} still busy after 5s — process may need SIGKILL.\n`,
		);
		process.exitCode = 1;
		return;
	}
	process.stdout.write("maket: stopped.\n");
}
