import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface MaketEnv {
	port: number;
	host: string;
	dataDir: string;
	pidFile: string;
	serverLog: string;
	serverSpawnLog: string;
	bridgeLog: string;
	url: string;
}

export interface MaketEnvOverrides {
	port?: number;
	host?: string;
	dataDir?: string;
}

/**
 * Resolve the Maket runtime env with layered precedence:
 *   CLI flag (override) > process env var > default.
 *
 * `dataDir` overrides are always resolved to an absolute path — detached
 * server children see a different cwd than the CLI, so a relative value like
 * `./data` would otherwise resolve twice.
 */
export function readEnv(overrides: MaketEnvOverrides = {}): MaketEnv {
	const port = overrides.port ?? Number(process.env.MAKET_PORT ?? 24842);
	const host = overrides.host ?? process.env.MAKET_HOST ?? "127.0.0.1";
	const rawDataDir =
		overrides.dataDir ??
		process.env.MAKET_DATA_DIR ??
		join(homedir(), ".maket");
	const dataDir = isAbsolute(rawDataDir) ? rawDataDir : resolve(rawDataDir);
	return {
		port,
		host,
		dataDir,
		pidFile: join(dataDir, "server.pid"),
		serverLog: join(dataDir, "server.log"),
		serverSpawnLog: join(dataDir, "server-spawn.log"),
		bridgeLog: join(dataDir, "bridge.log"),
		url: `http://${host}:${port}`,
	};
}
