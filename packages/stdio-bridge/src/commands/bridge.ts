/**
 * `maket bridge` — stdio ↔ HTTP MCP proxy.
 *
 * Probes the Maket HTTP server on MAKET_PORT; spawns one if absent, then
 * shuttles JSON-RPC frames between the parent process's stdin/stdout and the
 * server's /mcp endpoint. This is the default command when the binary is
 * invoked with no arguments (Claude Desktop / Codex / any stdio MCP client).
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createJsonRpcProxy } from "../proxy.ts";
import { ensureServer } from "../spawn.ts";
import { type MaketEnvOverrides, readEnv } from "./_env.ts";

/**
 * Resolve a spawn command from the environment, with strict validation to
 * shut the door on env-var injection attacks.
 *
 * - `MAKET_SERVER_ENTRY` must be an absolute path to an existing `.js`/`.mjs`
 *   file. We never accept a shell string or relative path.
 * - The legacy `MAKET_SERVER_CMD` (space-split) is no longer honoured —
 *   it allowed argument injection (`MAKET_SERVER_CMD="bash -c '…'"`).
 *   Override the spawn from code if you need a custom command.
 *
 * Returns `undefined` to let `ensureServer` fall back to the packaged
 * `defaultServerCmd()` (sibling `server.js` for npm installs, workspace
 * resolution in dev).
 */
function resolveServerCmd(): string[] | undefined {
	const entry = process.env.MAKET_SERVER_ENTRY;
	if (!entry) return undefined;
	if (!isAbsolute(entry) || !/\.(?:m?js)$/.test(entry) || !existsSync(entry)) {
		process.stderr.write(
			`maket: ignoring MAKET_SERVER_ENTRY="${entry}" — must be an absolute path to an existing .js or .mjs file.\n`,
		);
		return undefined;
	}
	return [process.execPath, entry];
}

// code-moniker: ignore[smell-feature-envy-local]
// stdio-bridge `runBridge`: transport adapter coordinating process I/O and MCP HTTP.
export async function runBridge(
	overrides: MaketEnvOverrides = {},
): Promise<void> {
	const { port, host, dataDir, bridgeLog, pidFile } = readEnv(overrides);
	const cmd = resolveServerCmd();

	const log = (msg: string) => {
		const line = `${new Date().toISOString()} ${msg}\n`;
		process.stderr.write(line);
		try {
			mkdirSync(dataDir, { recursive: true });
			appendFileSync(bridgeLog, line);
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
			pidFile,
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
