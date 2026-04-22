#!/usr/bin/env node

/**
 * @ng-galien/maket — bin entry.
 *
 * Two roles in one binary:
 *
 *  1. **stdio MCP bridge** — when invoked with no args (the way an MCP client
 *     spawns us), proxy stdio JSON-RPC to a local Maket HTTP server, spawning
 *     one if needed. This is the historical contract used by Claude Desktop,
 *     Codex, and friends.
 *  2. **CLI** — when invoked with a known subcommand (start, stop, status,
 *     install, …), dispatch and exit. Lets users manage the server and wire
 *     it into MCP clients without leaving the terminal.
 *
 * The router treats unknown args as "probably bridge mode misuse" and prints
 * help — but a stdin pipe always wins (some clients pass extra argv).
 *
 * Env contract (bridge mode):
 *   MAKET_PORT (default 24842) · MAKET_HOST (default 127.0.0.1)
 *   MAKET_DATA_DIR (default ~/.maket)
 *   MAKET_SERVER_ENTRY: absolute path to compiled server JS (preferred)
 *   MAKET_SERVER_CMD: legacy space-split spawn command
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBridge } from "./commands/bridge.ts";
import { runGmail } from "./commands/gmail.ts";
import { runHelp } from "./commands/help.ts";
import { runInstall } from "./commands/install.ts";
import { runLogs } from "./commands/logs.ts";
import { runOpen } from "./commands/open.ts";
import { runStart } from "./commands/start.ts";
import { runStatus } from "./commands/status.ts";
import { runStop } from "./commands/stop.ts";

function readVersion(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// Bundle: package.json sibling. Dev: one level up from src/.
	for (const candidate of [
		join(here, "package.json"),
		join(here, "..", "package.json"),
	]) {
		try {
			const pkg = JSON.parse(readFileSync(candidate, "utf-8"));
			if (pkg?.version) return pkg.version as string;
		} catch {}
	}
	return "unknown";
}

function printVersion(): void {
	process.stdout.write(`${readVersion()}\n`);
}

async function dispatch(argv: string[]): Promise<void> {
	const [cmd, ...rest] = argv;

	// No args + non-TTY stdin = an MCP client just spawned us. Bridge mode.
	if (!cmd) {
		if (process.stdin.isTTY) {
			runHelp();
			return;
		}
		await runBridge();
		return;
	}

	switch (cmd) {
		case "bridge":
			await runBridge();
			return;
		case "start":
			await runStart();
			return;
		case "stop":
			await runStop();
			return;
		case "status":
			await runStatus();
			return;
		case "open":
			runOpen();
			return;
		case "logs":
			runLogs(rest);
			return;
		case "install":
			runInstall(rest);
			return;
		case "gmail":
			await runGmail(rest);
			return;
		case "version":
		case "--version":
		case "-v":
			printVersion();
			return;
		case "help":
		case "--help":
		case "-h":
			runHelp();
			return;
		default:
			process.stderr.write(`maket: unknown command "${cmd}"\n\n`);
			runHelp();
			process.exitCode = 1;
	}
}

dispatch(process.argv.slice(2)).catch((e) => {
	process.stderr.write(
		`maket: ${(e as Error).stack ?? (e as Error).message}\n`,
	);
	process.exit(1);
});
