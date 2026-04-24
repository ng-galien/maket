/**
 * `maket start` — spawn the Maket HTTP server in the background.
 *
 * Idempotent: if the port already answers, reports the running instance
 * instead of spawning a duplicate. Writes the PID to $DATA_DIR/server.pid so
 * `maket stop` can find it.
 */

import { probeServer } from "../probe.ts";
import { ensureServer } from "../spawn.ts";
import { type MaketEnvOverrides, readEnv } from "./_env.ts";

export async function runStart(
	overrides: MaketEnvOverrides = {},
): Promise<void> {
	const env = readEnv(overrides);

	if (await probeServer(env.port, env.host, 300)) {
		process.stdout.write(
			`maket: already running on ${env.url} (data ${env.dataDir})\n`,
		);
		return;
	}

	process.stdout.write(`maket: starting on ${env.url}…\n`);
	const { pid } = await ensureServer({
		port: env.port,
		host: env.host,
		dataDir: env.dataDir,
		pidFile: env.pidFile,
	});
	process.stdout.write(
		`maket: started${pid ? ` (pid ${pid})` : ""} on ${env.url}\n`,
	);
	process.stdout.write(`maket: logs → ${env.dataDir}/server-spawn.log\n`);
}
