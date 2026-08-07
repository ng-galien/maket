/**
 * `maket install <claude|codex|gemini>` — register Maket as an MCP server in a client.
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
import { codexTomlSnippet, stripMaketSection } from "./_codex-toml.ts";
import { backup, refuseSymlink } from "./_fs-safety.ts";
import { resolveMaketRuntime } from "./_runtime-command.ts";

export type ClaudeScope = "user" | "project";
export type InstallClient = "claude" | "codex" | "gemini";

export interface InstallOpts {
	client: InstallClient;
	apply: boolean;
	scope: ClaudeScope;
}

export function formatCommandPreview(args: string[]): string {
	return args.map((arg) => JSON.stringify(arg)).join(" ");
}

function installClaude(opts: InstallOpts): void {
	const runtime = resolveMaketRuntime();
	const cliCmd = [
		"claude",
		"mcp",
		"add",
		"maket",
		"--scope",
		opts.scope,
		"--",
		runtime.command,
		...runtime.args,
	];
	const cliLine = formatCommandPreview(cliCmd);

	if (!opts.apply) {
		process.stdout.write(
			"maket: Claude Code MCP install (preview)\n\n" +
				`  ${cliLine}\n\n` +
				"Or, if the `claude` CLI is not installed, add this entry manually to\n" +
				`  ${opts.scope === "user" ? "~/.claude.json" : "<your-project>/.mcp.json"}:\n\n` +
				`${jsonSnippet()}\n` +
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

function jsonSnippet(): string {
	const runtime = resolveMaketRuntime();
	return JSON.stringify(
		{
			mcpServers: {
				maket: { command: runtime.command, args: runtime.args },
			},
		},
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
	const runtime = resolveMaketRuntime();
	servers.maket = { command: runtime.command, args: runtime.args };
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

function installGemini(opts: InstallOpts): void {
	const target = join(homedir(), ".gemini", "settings.json");

	if (!opts.apply) {
		process.stdout.write(
			"maket: Gemini CLI MCP install (preview)\n\n" +
				`Add the following mcpServers entry to ${target}:\n\n` +
				`${jsonSnippet()}\n\n` +
				"Re-run with --apply to write the config.\n",
		);
		return;
	}

	writeGeminiConfig(target);
}

function writeGeminiConfig(path: string): void {
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
	const runtime = resolveMaketRuntime();
	servers.maket = { command: runtime.command, args: runtime.args };
	json.mcpServers = servers;
	writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, {
		encoding: "utf-8",
		mode: 0o600,
	});
	process.stdout.write(`maket: wrote Gemini MCP config → ${path}\n`);
}

export function runInstall(opts: InstallOpts): void {
	if (opts.client === "claude") installClaude(opts);
	else if (opts.client === "codex") installCodex(opts);
	else installGemini(opts);
}
