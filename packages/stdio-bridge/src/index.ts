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
 * Bridge mode wins before cac even parses: no argv + non-TTY stdin means an
 * MCP client just spawned us and is about to pipe JSON-RPC frames. cac's
 * built-in `--help` auto-trigger would race against the stdin handshake, so
 * we detect this case first and go straight into `runBridge`.
 */

import cac, { type CAC } from "cac";
import type { MaketEnvOverrides } from "./commands/_env.ts";
import { readVersion } from "./commands/_version.ts";
import { runBridge } from "./commands/bridge.ts";
import { runConfig } from "./commands/config.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runGmail } from "./commands/gmail.ts";
import { runInstall } from "./commands/install.ts";
import { runLogs } from "./commands/logs.ts";
import { runOpen } from "./commands/open.ts";
import { runRestart } from "./commands/restart.ts";
import { runStart } from "./commands/start.ts";
import { runStatus } from "./commands/status.ts";
import { runStop } from "./commands/stop.ts";
import { runUninstall } from "./commands/uninstall.ts";
import { runUpdate } from "./commands/update.ts";

interface GlobalOpts {
	dataDir?: string;
	port?: number;
	host?: string;
}

function envOverrides(opts: GlobalOpts): MaketEnvOverrides {
	const out: MaketEnvOverrides = {};
	if (opts.dataDir) out.dataDir = opts.dataDir;
	if (typeof opts.port === "number") out.port = opts.port;
	if (opts.host) out.host = opts.host;
	return out;
}

function buildCli(): CAC {
	const cli = cac("maket");

	cli.option(
		"--data-dir <path>",
		"Server data directory (overrides MAKET_DATA_DIR)",
	);
	cli.option("--port <number>", "HTTP port (overrides MAKET_PORT)", {
		type: [Number],
	});
	cli.option("--host <host>", "Bind host (overrides MAKET_HOST)");

	cli
		.command("bridge", "Run stdio ↔ HTTP MCP proxy (default for MCP clients)")
		.action(async (opts: GlobalOpts) => {
			await runBridge(envOverrides(opts));
		});

	cli
		.command("start", "Start the Maket HTTP server in the background")
		.action(async (opts: GlobalOpts) => {
			await runStart(envOverrides(opts));
		});

	cli
		.command("stop", "Stop a server started by 'maket start'")
		.action(async (opts: GlobalOpts) => {
			await runStop(envOverrides(opts));
		});

	cli
		.command("restart", "Stop (if running) then start")
		.action(async (opts: GlobalOpts) => {
			await runRestart(envOverrides(opts));
		});

	cli
		.command("status", "Show whether the server is reachable")
		.action(async (opts: GlobalOpts) => {
			await runStatus(envOverrides(opts));
		});

	cli
		.command("open", "Open the Maket UI in your browser")
		.action((opts: GlobalOpts) => {
			runOpen(envOverrides(opts));
		});

	cli
		.command("logs", "Tail server logs")
		.option("--bridge", "Tail the stdio-bridge log instead of the server log")
		.option("--no-follow", "Print a snapshot and exit")
		.action((opts: GlobalOpts & { bridge?: boolean; follow?: boolean }) => {
			runLogs({
				...envOverrides(opts),
				bridge: opts.bridge,
				follow: opts.follow,
			});
		});

	cli
		.command("config", "Print the resolved runtime config")
		.action((opts: GlobalOpts) => {
			runConfig(envOverrides(opts));
		});

	cli
		.command(
			"doctor",
			"One-shot diagnostic (node, port, data dir, Chromium, …)",
		)
		.action(async (opts: GlobalOpts) => {
			await runDoctor(envOverrides(opts));
		});

	cli
		.command("update [version]", "Upgrade the CLI (or pin to <version>)")
		.option("--check", "Compare current vs npm latest; exit 0/1, no mutation")
		.action(async (version: string | undefined, opts: { check?: boolean }) => {
			await runUpdate({ version, check: opts.check });
		});

	cli
		.command("install <client>", "Install Maket as an MCP server in a client")
		.option("--apply", "Write the config (default: print only)")
		.option("--scope <scope>", "Claude scope: user | project", {
			default: "user",
		})
		.action((client: string, opts: { apply?: boolean; scope?: string }) => {
			if (client !== "claude" && client !== "codex") {
				process.stderr.write(
					`maket install: client must be "claude" or "codex" (got "${client}")\n`,
				);
				process.exitCode = 1;
				return;
			}
			runInstall({
				client,
				apply: opts.apply === true,
				scope: opts.scope === "project" ? "project" : "user",
			});
		});

	cli
		.command("uninstall <client>", "Remove Maket from an MCP client")
		.option("--apply", "Execute the removal (default: print only)")
		.option("--scope <scope>", "Claude scope: user | project", {
			default: "user",
		})
		.action((client: string, opts: { apply?: boolean; scope?: string }) => {
			if (client !== "claude" && client !== "codex") {
				process.stderr.write(
					`maket uninstall: client must be "claude" or "codex" (got "${client}")\n`,
				);
				process.exitCode = 1;
				return;
			}
			runUninstall({
				client,
				apply: opts.apply === true,
				scope: opts.scope === "project" ? "project" : "user",
			});
		});

	cli
		.command("gmail [sub]", "Manage Gmail OAuth state (status | reset)")
		.option("--force", "Skip the y/N prompt on reset")
		.action(
			async (
				sub: string | undefined,
				opts: GlobalOpts & { force?: boolean },
			) => {
				await runGmail(sub, { ...envOverrides(opts), force: opts.force });
			},
		);

	cli.help();
	cli.version(readVersion());
	return cli;
}

async function main(argv: string[]): Promise<void> {
	// No args + non-TTY stdin = an MCP client just spawned us. Bridge mode
	// short-circuits cac so the stdin handshake isn't interrupted by
	// auto-help. An MCP client that needs a custom data dir passes
	// MAKET_DATA_DIR via its own config.
	if (argv.length === 0 && !process.stdin.isTTY) {
		await runBridge();
		return;
	}

	const cli = buildCli();

	if (argv.length === 0) {
		cli.outputHelp();
		return;
	}

	cli.parse(["node", "maket", ...argv]);

	// cac prints --help / --version output but doesn't exit — it leaves
	// `matchedCommand` unset even when a valid command preceded the flag. Don't
	// treat that as an unknown-command error.
	if (cli.options.help || cli.options.version) return;

	// `maket foo` with no registered `foo` command: cac leaves matchedCommand
	// undefined. Exit non-zero for discoverability.
	const firstArg = argv[0];
	const hasUnknown =
		!cli.matchedCommand && firstArg !== undefined && !firstArg.startsWith("-");
	if (hasUnknown) {
		process.stderr.write(`maket: unknown command "${firstArg}"\n\n`);
		cli.outputHelp();
		process.exitCode = 1;
	}
}

main(process.argv.slice(2)).catch((e) => {
	process.stderr.write(
		`maket: ${(e as Error).stack ?? (e as Error).message}\n`,
	);
	process.exit(1);
});
