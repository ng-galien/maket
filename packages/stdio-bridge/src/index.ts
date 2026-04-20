#!/usr/bin/env node

/**
 * @maket/stdio-bridge — launches/reuses a Maket HTTP server and proxies
 * Claude Desktop's stdio JSON-RPC to it.
 *
 * Behavior:
 *  1. Probe TCP on MAKET_PORT (default 24842). If reachable, proxy.
 *  2. If not, spawn a detached server with MAKET_PORT + MAKET_DATA_DIR env,
 *     wait for it to listen, then proxy.
 *  3. Exits with stdin close; does not kill the server on exit.
 *
 * Env contract:
 *  - MAKET_PORT (default 24842)
 *  - MAKET_HOST (default 127.0.0.1)
 *  - MAKET_DATA_DIR (default ~/.maket)
 *  - MAKET_SERVER_ENTRY (preferred): absolute path to the server JS — spawned
 *    as `[process.execPath, entry]`. Space-safe.
 *  - MAKET_SERVER_CMD (legacy): shell-split on space — avoid when paths may
 *    contain spaces (e.g. Claude Desktop extension dir).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createJsonRpcProxy } from "./proxy.ts";
import { ensureServer } from "./spawn.ts";

function resolveServerCmd(): string[] | undefined {
	if (process.env.MAKET_SERVER_ENTRY) {
		return [process.execPath, process.env.MAKET_SERVER_ENTRY];
	}
	if (process.env.MAKET_SERVER_CMD) {
		return process.env.MAKET_SERVER_CMD.split(" ").filter(Boolean);
	}
	return undefined;
}

async function main(): Promise<void> {
	const port = Number(process.env.MAKET_PORT ?? 24842);
	const host = process.env.MAKET_HOST ?? "127.0.0.1";
	const dataDir = process.env.MAKET_DATA_DIR ?? join(homedir(), ".maket");
	const cmd = resolveServerCmd();

	const logPath = join(dataDir, "bridge.log");
	const log = (msg: string) => {
		const line = `${new Date().toISOString()} ${msg}\n`;
		process.stderr.write(line);
		try {
			mkdirSync(dataDir, { recursive: true });
			appendFileSync(logPath, line);
		} catch {}
	};

	log(
		`boot pid=${process.pid} port=${port} host=${host} dataDir=${dataDir} cmd=${cmd ? JSON.stringify(cmd) : "(default)"}`,
	);

	try {
		const { started, alreadyRunning } = await ensureServer({
			port,
			host,
			dataDir,
			cmd,
		});
		log(`ensureServer ok started=${started} alreadyRunning=${alreadyRunning}`);
	} catch (e) {
		log(`fatal ensureServer: ${(e as Error).stack ?? (e as Error).message}`);
		process.exit(1);
	}

	const proxy = createJsonRpcProxy({
		url: `http://${host}:${port}/mcp`,
		stdin: process.stdin,
		stdout: process.stdout,
		stderr: process.stderr,
	});

	process.on("SIGINT", () => proxy.stop());
	process.on("SIGTERM", () => proxy.stop());
	process.stdin.on("close", () => proxy.stop());

	await proxy.done;
	log("proxy.done (stdin closed); exiting");
}

main().catch((e) => {
	process.stderr.write(`[stdio-bridge] unhandled: ${(e as Error).stack}\n`);
	process.exit(1);
});
