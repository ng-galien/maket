#!/usr/bin/env node

/**
 * @ng-galien/maket — bin entry.
 *
 * Two roles in one binary:
 *
 *  1. **stdio MCP gateway** — when invoked with no args (the way an MCP client
 *     spawns us), expose the local Maket HTTP server through the MCP SDK's
 *     stdio transport, spawning the HTTP server if needed.
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
	port?: Array<number | undefined>;
	host?: string;
}

type SupportedClient = "claude" | "codex" | "gemini";

class CliUsageError extends Error {}

function parsePort(value: string | number | undefined): number | undefined {
	if (value === undefined) return undefined;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new CliUsageError("--port must be an integer between 1 and 65535");
	}
	return port;
}

function envOverrides(opts: GlobalOpts): MaketEnvOverrides {
	const out: MaketEnvOverrides = {};
	if (opts.dataDir) out.dataDir = opts.dataDir;
	const port = opts.port?.at(-1);
	if (port !== undefined) out.port = port;
	if (opts.host) out.host = opts.host;
	return out;
}

function supportedClient(client: string): SupportedClient | null {
	return client === "claude" || client === "codex" || client === "gemini"
		? client
		: null;
}

function clientScope(scope: string | undefined) {
	return scope === "project" ? "project" : "user";
}

function handleInstall(
	client: string,
	opts: { apply?: boolean; scope?: string },
) {
	const selected = supportedClient(client);
	if (!selected) {
		unsupportedClient("install", client);
		return;
	}
	runInstall({
		client: selected,
		apply: opts.apply === true,
		scope: clientScope(opts.scope),
	});
}

function handleUninstall(
	client: string,
	opts: { apply?: boolean; scope?: string },
) {
	const selected = supportedClient(client);
	if (!selected) {
		unsupportedClient("uninstall", client);
		return;
	}
	runUninstall({
		client: selected,
		apply: opts.apply === true,
		scope: clientScope(opts.scope),
	});
}

function unsupportedClient(command: string, client: string): void {
	process.stderr.write(
		`maket ${command}: client must be "claude", "codex", or "gemini" (got "${client}")\n`,
	);
	process.exitCode = 1;
}

/** A fresh instance has no matched command, so cac renders the global help
 *  rather than the usage of `help` itself. */
function outputGlobalHelp(): void {
	buildCli().outputHelp();
}

function buildCli(): CAC {
	const cli = cac("maket");

	cli.option(
		"--data-dir <path>",
		"Server data directory (overrides MAKET_DATA_DIR)",
	);
	cli.option("--port <number>", "HTTP port (overrides MAKET_PORT)", {
		type: [parsePort],
	});
	cli.option("--host <host>", "Bind host (overrides MAKET_HOST)");

	cli
		.command("bridge", "Run the MCP v2 stdio gateway (default for MCP clients)")
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
		.action(handleInstall);

	cli
		.command("uninstall <client>", "Remove Maket from an MCP client")
		.option("--apply", "Execute the removal (default: print only)")
		.option("--scope <scope>", "Claude scope: user | project", {
			default: "user",
		})
		.action(handleUninstall);

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

	cli.command("help", "Show this help").action(outputGlobalHelp);
	cli.command("version", "Print the Maket version").action(() => {
		process.stdout.write(`${readVersion()}\n`);
	});

	cli.help();
	cli.version(readVersion());
	return cli;
}

async function main(argv: string[]): Promise<void> {
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

	if (cli.options.help || cli.options.version) return;

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
	const error = e instanceof Error ? e : new Error(String(e));
	const detail =
		error instanceof CliUsageError || error.name === "CACError"
			? error.message
			: (error.stack ?? error.message);
	process.stderr.write(`maket: ${detail}\n`);
	process.exit(1);
});
