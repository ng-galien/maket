import { homedir } from "node:os";
import { join } from "node:path";

export interface MaketEnv {
	port: number;
	host: string;
	dataDir: string;
	pidFile: string;
	serverLog: string;
	bridgeLog: string;
	url: string;
}

export function readEnv(): MaketEnv {
	const port = Number(process.env.MAKET_PORT ?? 24842);
	const host = process.env.MAKET_HOST ?? "127.0.0.1";
	const dataDir = process.env.MAKET_DATA_DIR ?? join(homedir(), ".maket");
	return {
		port,
		host,
		dataDir,
		pidFile: join(dataDir, "server.pid"),
		serverLog: join(dataDir, "server.log"),
		bridgeLog: join(dataDir, "bridge.log"),
		url: `http://${host}:${port}`,
	};
}
