#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	publishRuntimeOwnership,
	readPackageVersion,
} from "./src/runtime-ownership.js";
import { startMaketServer } from "./src/server.js";
import { createBrowserPool } from "./src/services/browser-pool.js";

function crashLog(message: string): void {
	process.stderr.write(`${message}\n`);
	try {
		const path = join(
			process.env.MAKET_DATA_DIR || join(homedir(), ".maket"),
			"crash.log",
		);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${new Date().toISOString()} ${message}\n`, {
			flag: "a",
		});
	} catch {}
}

process.on("uncaughtException", (error) => {
	crashLog(`[FATAL] Uncaught: ${error.stack || error.message}`);
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	crashLog(
		`[FATAL] Rejection: ${reason instanceof Error ? reason.stack || reason.message : reason}`,
	);
	process.exit(1);
});

const server = await startMaketServer({
	bootstrap: { browserPoolFactory: createBrowserPool },
});
// Publish workspace ownership so the desktop application detects this server
// instead of silently starting a second one on the same SQLite workspace.
const ownership = publishRuntimeOwnership({
	dataDir: server.config.DATA_DIR,
	host: server.config.HOST,
	port: Number(new URL(server.url).port) || server.config.PORT,
	version: readPackageVersion(server.config.PACKAGE_DIR),
});
process.on("exit", () => ownership.release());
let stopping = false;
const stop = async (signal: NodeJS.Signals) => {
	if (stopping) return;
	stopping = true;
	process.stderr.write(`Received ${signal}, shutting down...\n`);
	try {
		await server.close();
		ownership.release();
		process.exit(0);
	} catch (error) {
		crashLog(
			`Dispose error: ${error instanceof Error ? error.message : error}`,
		);
		process.exit(1);
	}
};
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
