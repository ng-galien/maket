#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { startMaketServer } from "./src/server.js";

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

const server = await startMaketServer();
let stopping = false;
const stop = async (signal: NodeJS.Signals) => {
	if (stopping) return;
	stopping = true;
	process.stderr.write(`Received ${signal}, shutting down...\n`);
	try {
		await server.close();
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
