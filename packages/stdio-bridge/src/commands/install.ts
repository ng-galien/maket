/**
 * `maket install <claude|codex>` — register Maket as an MCP server in a client.
 *
 * Print-only by default, `--apply` to actually write/run. Claude Code prefers
 * `claude mcp add` when the CLI is on PATH, falls back to editing
 * `~/.claude.json` (user) or `<cwd>/.mcp.json` (project). Codex CLI edits
 * `~/.codex/config.toml`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hasBin } from "./_bin.ts";
import { codexTomlSnippet, PKG, stripMaketSection } from "./_codex-toml.ts";
import { backup, refuseSymlink } from "./_fs-safety.ts";

const CMD = "npx";
const ARGS = ["-y", PKG];

export type ClaudeScope = "user" | "project";

export interface InstallOpts {
	client: "claude" | "codex";
	apply: boolean;
	scope: ClaudeScope;
}

function installClaude(opts: InstallOpts): void {
	const cliCmd = [
		"claude",
		"mcp",
		"add",
		"maket",
		"--scope",
		opts.scope,
		"--",
		CMD,
		...ARGS,
	];
	const cliLine = cliCmd.join(" ");

	if (!opts.apply) {
		process.stdout.write(
			"maket: Claude Code MCP install (preview)\n\n" +
				`  ${cliLine}\n\n` +
				"Or, if the `claude` CLI is not installed, add this entry manually to\n" +
				`  ${opts.scope === "user" ? "~/.claude.json" : "<your-project>/.mcp.json"}:\n\n` +
				`${claudeJsonSnippet()}\n` +
				"Re-run with --apply to write the config.\n",
		);
		return;
	}

	if (hasBin("claude")) {
		process.stdout.write(`maket: running \`${cliLine}\`\n`);
		try {
			execFileSync("claude", cliCmd.slice(1), { stdio: "inherit" });
			process.stdout.write("maket: Claude Code is configured.\n");
			return;
		} catch (e) {
			process.stderr.write(
				`maket: \`claude mcp add\` failed (${(e as Error).message}). Falling back to file edit.\n`,
			);
		}
	}

	const target =
		opts.scope === "user"
			? join(homedir(), ".claude.json")
			: join(process.cwd(), ".mcp.json");
	writeClaudeConfig(target, opts.scope);
}

function claudeJsonSnippet(): string {
	return JSON.stringify(
		{ mcpServers: { maket: { command: CMD, args: ARGS } } },
		null,
		2,
	);
}

function writeClaudeConfig(path: string, scope: ClaudeScope): void {
	if (refuseSymlink(path)) return;
	let json: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			json = JSON.parse(readFileSync(path, "utf-8"));
		} catch {
			process.stderr.write(
				`maket: ${path} is not valid JSON — refusing to overwrite.\n`,
			);
			process.exitCode = 1;
			return;
		}
		backup(path);
	} else {
		mkdirSync(dirname(path), { recursive: true });
	}

	const servers = ((json.mcpServers as Record<string, unknown>) ??
		{}) as Record<string, unknown>;
	servers.maket = { command: CMD, args: ARGS };
	json.mcpServers = servers;
	writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, {
		encoding: "utf-8",
		mode: 0o600,
	});
	process.stdout.write(`maket: wrote ${scope}-scope config → ${path}\n`);
}

function installCodex(opts: InstallOpts): void {
	const target = join(homedir(), ".codex", "config.toml");

	if (!opts.apply) {
		process.stdout.write(
			"maket: Codex CLI MCP install (preview)\n\n" +
				`Add the following to ${target}:\n\n` +
				`${codexTomlSnippet()}\n\n` +
				"Re-run with --apply to write the config (an existing maket section will be replaced).\n",
		);
		return;
	}

	if (refuseSymlink(target)) return;
	mkdirSync(dirname(target), { recursive: true });
	const existing = existsSync(target) ? readFileSync(target, "utf-8") : "";
	if (existing) backup(target);

	const stripped = stripMaketSection(existing);
	const sep =
		stripped.length === 0 || stripped.endsWith("\n\n")
			? ""
			: stripped.endsWith("\n")
				? "\n"
				: "\n\n";
	const next = `${stripped}${sep}${codexTomlSnippet()}\n`;
	writeFileSync(target, next, { encoding: "utf-8", mode: 0o600 });
	process.stdout.write(`maket: wrote Codex MCP config → ${target}\n`);
}

export function runInstall(opts: InstallOpts): void {
	if (opts.client === "claude") installClaude(opts);
	else installCodex(opts);
}
